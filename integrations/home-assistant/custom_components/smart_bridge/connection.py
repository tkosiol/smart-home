"""MQTT connection to the platform broker (spec 7): WebSocket with user and key, will, reconnect,
retained QoS 1.

Runs paho's network thread (loop_start). Callbacks arrive on that thread; on_connected,
on_auth_failed and on_auth_recovered must hop into the event loop themselves.

A refused key (CONNACK "not authorised" or "bad user name or password") is retried with the normal
backoff: after a restart the broker knows no gateway until the backend has reconciled. Only when
refusals last 15 minutes without a break does on_auth_failed run (once; the entry then asks for a
new code), and paho goes on trying every 10 minutes. A later successful connect calls
on_auth_recovered. start() and stop() block (system CAs, thread join): call them in the executor.
"""

from __future__ import annotations

import logging
import ssl
import sys
import threading
import time
from collections.abc import Callable, Sequence
from typing import Any, Protocol
from urllib.parse import urlsplit

from paho.mqtt import client as mqtt
from paho.mqtt.enums import CallbackAPIVersion
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.reasoncodes import ReasonCode

from .protocol import connection_topic

_LOGGER = logging.getLogger(__name__)

QOS = 1
KEEPALIVE_SECONDS = 30
RECONNECT_MIN_SECONDS = 1
RECONNECT_MAX_SECONDS = 60
STOP_TIMEOUT_SECONDS = 5.0
# Refusals must last this long before the key counts as invalid: longer than the backend's
# reconcile interval (10 min), so a restarted broker does not trigger a reauth.
AUTH_GRACE_SECONDS = 900.0
# Reconnect delay once the key counts as invalid, so a revoked gateway does not hammer the broker.
AUTH_RETRY_SECONDS = 600
# CONNACK reasons for a refused user, key or client ID binding.
AUTH_REFUSALS = (
    ReasonCode(PacketTypes.CONNACK, "Not authorized"),
    ReasonCode(PacketTypes.CONNACK, "Bad user name or password"),
)


class Connection(Protocol):
    def start(self) -> None:
        """Non-blocking for the caller's logic: connects in the background, reconnects (1–60 s)."""

    def stop(self, offline_payloads: Sequence[tuple[str, bytes]]) -> None:
        """Publish these (QoS 1, retained), wait at most 5 s, disconnect."""

    def publish(self, topic: str, payload: bytes) -> None:
        """QoS 1, retained; dropped while disconnected."""

    @property
    def connected(self) -> bool: ...


def _tls_context() -> ssl.SSLContext:
    """System CAs; the certificate and host name of the app are verified (TLS 1.2 or newer)."""
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    return context


class PahoConnection:
    """Connection over paho-mqtt. All paho callbacks run on paho's network thread."""

    def __init__(
        self,
        *,
        gateway_id: str,
        mqtt_url: str,
        username: str,
        password: str,
        client_id: str,
        on_connected: Callable[[], None],
        on_auth_failed: Callable[[], None],
        on_auth_recovered: Callable[[], None],
        clock: Callable[[], float] = time.monotonic,
        auth_grace_seconds: float = AUTH_GRACE_SECONDS,
        auth_retry_seconds: int = AUTH_RETRY_SECONDS,
    ) -> None:
        url = urlsplit(mqtt_url)
        self._tls = url.scheme == "wss"
        self._host = url.hostname or ""
        self._port = url.port or (443 if self._tls else 80)
        self._path = url.path or "/"
        self._username = username
        self._password = password
        self._client_id = client_id
        self._on_connected = on_connected
        self._on_auth_failed = on_auth_failed
        self._on_auth_recovered = on_auth_recovered
        self._clock = clock
        self._auth_grace_seconds = auth_grace_seconds
        self._auth_retry_seconds = auth_retry_seconds
        # Paho's thread only: start of the current run of refused keys, and whether it was reported.
        self._refused_since: float | None = None
        self._auth_reported = False
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
            client_id=self._client_id,
            protocol=mqtt.MQTTv311,
            transport="websockets",
        )
        client.ws_set_options(path=self._path)
        client.username_pw_set(self._username, self._password)
        if self._tls:
            client.tls_set_context(_tls_context())
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
            reason = str(reason_code)
            if reason != self._failure_reported:
                self._failure_reported = reason
                _LOGGER.warning("Broker refused the connection: %s", reason)
            else:
                _LOGGER.debug("Broker still refuses the connection: %s", reason)
            if reason_code in AUTH_REFUSALS:
                self._handle_auth_refused(client)
            return
        with self._state:
            if self._stopped:
                return
            self._connected.set()
            client.publish(self._connection_topic, b"1", qos=QOS, retain=True)
        self._failure_reported = None
        _LOGGER.info("Connected to the platform broker")
        self._handle_auth_accepted(client)
        try:
            self._on_connected()
        except Exception:
            _LOGGER.exception("Handling the new connection failed")

    def _handle_auth_refused(self, client: mqtt.Client) -> None:
        """Keep retrying; after the grace, report once and retry only every few minutes."""
        now = self._clock()
        if self._refused_since is None:
            self._refused_since = now
        if self._auth_reported or now - self._refused_since < self._auth_grace_seconds:
            return
        with self._state:
            if self._stopped:
                return
        self._auth_reported = True
        delay = self._auth_retry_seconds
        client.reconnect_delay_set(min_delay=delay, max_delay=delay)
        _LOGGER.warning("The platform refuses the key; pair again with a new code")
        try:
            self._on_auth_failed()
        except Exception:
            _LOGGER.exception("Handling the refused key failed")

    def _handle_auth_accepted(self, client: mqtt.Client) -> None:
        """A successful connect ends a run of refusals; a reported one is taken back."""
        self._refused_since = None
        if not self._auth_reported:
            return
        self._auth_reported = False
        client.reconnect_delay_set(min_delay=RECONNECT_MIN_SECONDS, max_delay=RECONNECT_MAX_SECONDS)
        _LOGGER.info("The platform accepts the key again")
        try:
            self._on_auth_recovered()
        except Exception:
            _LOGGER.exception("Handling the accepted key failed")

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
