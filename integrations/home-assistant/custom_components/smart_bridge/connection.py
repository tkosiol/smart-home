"""MQTT connection to the platform broker (spec 4.2): mTLS, will, reconnect, retained QoS 1.

Runs paho's network thread (loop_start). Callbacks arrive on that thread; on_connected must hop into
the event loop itself. start() and stop() block (TLS files, thread join): call them in the executor.
"""

from __future__ import annotations

import logging
import ssl
import sys
import threading
import time
from collections.abc import Callable, Sequence
from typing import Any, Protocol

from paho.mqtt import client as mqtt
from paho.mqtt.enums import CallbackAPIVersion

from .protocol import connection_topic

_LOGGER = logging.getLogger(__name__)

QOS = 1
KEEPALIVE_SECONDS = 30
RECONNECT_MIN_SECONDS = 1
RECONNECT_MAX_SECONDS = 60
STOP_TIMEOUT_SECONDS = 5.0


class Connection(Protocol):
    def start(self) -> None:
        """Non-blocking for the caller's logic: connects in the background, reconnects (1–60 s)."""

    def stop(self, offline_payloads: Sequence[tuple[str, bytes]]) -> None:
        """Publish these (QoS 1, retained), wait at most 5 s, disconnect."""

    def publish(self, topic: str, payload: bytes) -> None:
        """QoS 1, retained; dropped while disconnected."""

    @property
    def connected(self) -> bool: ...


def _tls_context(ca_file: str, cert_file: str, key_file: str) -> ssl.SSLContext:
    """TLS 1.2 with a client certificate; the broker certificate and host name are verified."""
    context = ssl.create_default_context(ssl.Purpose.SERVER_AUTH, cafile=ca_file)
    context.load_cert_chain(certfile=cert_file, keyfile=key_file)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.maximum_version = ssl.TLSVersion.TLSv1_2
    return context


class PahoConnection:
    """Connection over paho-mqtt. All paho callbacks run on paho's network thread."""

    def __init__(
        self,
        *,
        gateway_id: str,
        host: str,
        port: int,
        ca_file: str,
        cert_file: str,
        key_file: str,
        on_connected: Callable[[], None],
    ) -> None:
        self._gateway_id = gateway_id
        self._host = host
        self._port = port
        self._ca_file = ca_file
        self._cert_file = cert_file
        self._key_file = key_file
        self._on_connected = on_connected
        self._connection_topic = connection_topic(gateway_id)
        self._client: mqtt.Client | None = None
        self._connected = threading.Event()
        self._failure_reported: str | None = None  # last connect error warned about
        # start() and stop() run in executor threads and may overlap when HA stops early.
        self._lifecycle = threading.Lock()
        # Orders a late CONNACK against stop(): "1" is either queued before "offline"/"0" or not
        # at all. Held only for non-blocking calls, so paho's thread never waits long.
        self._state = threading.Lock()
        self._stopped = False

    @property
    def connected(self) -> bool:
        return self._connected.is_set()

    def start(self) -> None:
        with self._lifecycle:
            if self._stopped or self._client is not None:
                return
            self._start()

    def _start(self) -> None:
        client = mqtt.Client(
            callback_api_version=CallbackAPIVersion.VERSION2,
            client_id=f"{self._gateway_id}-ha",
            protocol=mqtt.MQTTv311,
        )
        client.tls_set_context(_tls_context(self._ca_file, self._cert_file, self._key_file))
        client.will_set(self._connection_topic, b"0", qos=QOS, retain=True)
        client.reconnect_delay_set(min_delay=RECONNECT_MIN_SECONDS, max_delay=RECONNECT_MAX_SECONDS)
        client.on_connect = self._handle_connect
        client.on_connect_fail = self._handle_connect_fail
        client.on_disconnect = self._handle_disconnect
        client.connect_async(self._host, self._port, keepalive=KEEPALIVE_SECONDS)
        self._client = client
        client.loop_start()
        _LOGGER.info("Connecting to the platform broker")

    def publish(self, topic: str, payload: bytes) -> None:
        client = self._client
        if client is None or not self.connected:
            return
        client.publish(topic, payload, qos=QOS, retain=True)

    def stop(self, offline_payloads: Sequence[tuple[str, bytes]]) -> None:
        with self._lifecycle:
            with self._state:
                self._stopped = True
                was_connected = self.connected
                self._connected.clear()  # publish() drops from now on
                client = self._client
                infos = (
                    [client.publish(t, p, qos=QOS, retain=True) for t, p in offline_payloads]
                    if client is not None and was_connected
                    else []
                )
            if client is not None:
                self._stop(client, infos)

    def _stop(self, client: mqtt.Client, infos: Sequence[mqtt.MQTTMessageInfo]) -> None:
        deadline = time.monotonic() + STOP_TIMEOUT_SECONDS
        for info in infos:
            try:
                info.wait_for_publish(timeout=max(0.0, deadline - time.monotonic()))
            except (RuntimeError, ValueError) as err:
                _LOGGER.warning("Offline message not delivered: %s", err)
        client.disconnect()
        client.loop_stop()
        _LOGGER.info("Disconnected from the platform broker")

    # paho callbacks (network thread) --------------------------------------------------------

    def _handle_connect(
        self, client: mqtt.Client, _userdata: Any, _flags: Any, reason_code: Any, _props: Any
    ) -> None:
        if reason_code.is_failure:
            self._connected.clear()
            _LOGGER.warning("Broker refused the connection: %s", reason_code)
            return
        with self._state:
            if self._stopped:
                return
            self._connected.set()
            client.publish(self._connection_topic, b"1", qos=QOS, retain=True)
        self._failure_reported = None
        _LOGGER.info("Connected to the platform broker")
        try:
            self._on_connected()
        except Exception:
            _LOGGER.exception("Handling the new connection failed")

    def _handle_connect_fail(self, _client: mqtt.Client, _userdata: Any) -> None:
        # paho calls this inside `except OSError` around reconnect(), so the error (TLS
        # verification, refused, DNS, timeout) is the exception being handled.
        err = sys.exception()
        reason = str(err) if err is not None else "unknown error"
        if reason != self._failure_reported:
            self._failure_reported = reason
            _LOGGER.warning("Cannot reach the platform broker (retrying with backoff): %s", reason)
        else:
            _LOGGER.debug("Still cannot reach the platform broker: %s", reason)

    def _handle_disconnect(
        self, _client: mqtt.Client, _userdata: Any, _flags: Any, reason_code: Any, _props: Any
    ) -> None:
        was_connected = self.connected
        self._connected.clear()
        if was_connected:
            _LOGGER.warning("Disconnected from the platform broker: %s", reason_code)
