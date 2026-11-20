"""PahoConnection tests (spec 7): patched paho client, plus real paho against a fake broker."""

from __future__ import annotations

import base64
import contextlib
import hashlib
import logging
import socket
import ssl
import threading
import time
from collections.abc import Iterator
from unittest.mock import MagicMock, call, patch

import pytest
from paho.mqtt import client as mqtt
from paho.mqtt.enums import CallbackAPIVersion
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.reasoncodes import ReasonCode

from custom_components.smart_bridge import connection as connection_module
from custom_components.smart_bridge.connection import PahoConnection

GW = "gw-abcdefgh"
CLIENT_ID = f"{GW}-ha"
PASSWORD = "key-generation-1"
CONNECTION_TOPIC = f"gw/{GW}/bridge/connection"
SUCCESS = ReasonCode(PacketTypes.CONNACK, "Success")
NOT_AUTHORIZED = ReasonCode(PacketTypes.CONNACK, "Not authorized")
BAD_CREDENTIALS = ReasonCode(PacketTypes.CONNACK, "Bad user name or password")
SERVER_UNAVAILABLE = ReasonCode(PacketTypes.CONNACK, "Server unavailable")


@pytest.fixture
def client_class():
    with patch("paho.mqtt.client.Client", autospec=True) as client_class:
        yield client_class


@pytest.fixture
def create_context():
    """Spy on the TLS context factory: the real one runs, the call is recorded."""
    with patch.object(
        connection_module.ssl, "create_default_context", wraps=ssl.create_default_context
    ) as factory:
        yield factory


@pytest.fixture
def on_connected():
    return MagicMock()


@pytest.fixture
def on_auth_failed():
    return MagicMock()


def make_conn(on_connected, on_auth_failed, mqtt_url="wss://smart.example.org/mqtt"):
    return PahoConnection(
        gateway_id=GW,
        mqtt_url=mqtt_url,
        username=GW,
        password=PASSWORD,
        client_id=CLIENT_ID,
        on_connected=on_connected,
        on_auth_failed=on_auth_failed,
    )


@pytest.fixture
def conn(client_class, on_connected, on_auth_failed) -> PahoConnection:
    return make_conn(on_connected, on_auth_failed)


def client_of(client_class) -> MagicMock:
    return client_class.return_value


def test_start_configures_websocket_client_with_tls(
    client_class, create_context, on_connected, on_auth_failed
):
    conn = make_conn(on_connected, on_auth_failed)
    client_class.assert_not_called()  # nothing blocking before start()

    conn.start()

    client_class.assert_called_once_with(
        callback_api_version=CallbackAPIVersion.VERSION2,
        client_id=CLIENT_ID,
        protocol=mqtt.MQTTv311,
        transport="websockets",
    )
    client = client_of(client_class)
    client.ws_set_options.assert_called_once_with(path="/mqtt")
    client.username_pw_set.assert_called_once_with(GW, PASSWORD)
    create_context.assert_called_once_with()  # system CAs, no own CA file
    (context,), _ = client.tls_set_context.call_args
    assert isinstance(context, ssl.SSLContext)
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname
    assert context.minimum_version == ssl.TLSVersion.TLSv1_2
    client.will_set.assert_called_once_with(CONNECTION_TOPIC, b"0", qos=1, retain=True)
    client.reconnect_delay_set.assert_called_once_with(min_delay=1, max_delay=60)
    client.connect_async.assert_called_once_with("smart.example.org", 443, keepalive=30)
    client.loop_start.assert_called_once_with()
    assert not conn.connected


@pytest.mark.parametrize(
    ("mqtt_url", "host", "port", "path"),
    [
        ("ws://localhost:4200/mqtt", "localhost", 4200, "/mqtt"),
        ("ws://web/mqtt", "web", 80, "/mqtt"),
        ("ws://[::1]:8080/broker/mqtt", "::1", 8080, "/broker/mqtt"),
    ],
)
def test_plain_websocket_without_tls(
    client_class, create_context, on_connected, on_auth_failed, mqtt_url, host, port, path
):
    conn = make_conn(on_connected, on_auth_failed, mqtt_url=mqtt_url)

    conn.start()

    client = client_of(client_class)
    client.tls_set_context.assert_not_called()
    create_context.assert_not_called()
    client.ws_set_options.assert_called_once_with(path=path)
    client.connect_async.assert_called_once_with(host, port, keepalive=30)


def test_wss_with_explicit_port(client_class, on_connected, on_auth_failed):
    conn = make_conn(on_connected, on_auth_failed, mqtt_url="wss://smart.example.org:8443/mqtt")

    conn.start()

    client_of(client_class).connect_async.assert_called_once_with(
        "smart.example.org", 8443, keepalive=30
    )


def test_on_connect_publishes_online_and_calls_back(conn, client_class, on_connected):
    conn.start()
    client = client_of(client_class)

    client.on_connect(client, None, MagicMock(), SUCCESS, None)

    assert conn.connected
    client.publish.assert_called_once_with(CONNECTION_TOPIC, b"1", qos=1, retain=True)
    on_connected.assert_called_once_with()


@pytest.mark.parametrize("reason", [NOT_AUTHORIZED, BAD_CREDENTIALS])
def test_refused_key_reports_once_and_stops_reconnecting(
    conn, client_class, on_connected, on_auth_failed, caplog, reason
):
    conn.start()
    client = client_of(client_class)

    with caplog.at_level(logging.WARNING):
        client.on_connect(client, None, MagicMock(), reason, None)
        client.on_connect(client, None, MagicMock(), reason, None)  # a late duplicate

    assert not conn.connected
    client.publish.assert_not_called()
    on_connected.assert_not_called()
    on_auth_failed.assert_called_once_with()
    client.disconnect.assert_called_once_with()
    client.loop_stop.assert_called_once_with()
    assert str(reason) in caplog.text


def test_auth_callback_errors_do_not_reach_paho(conn, client_class, on_auth_failed):
    on_auth_failed.side_effect = RuntimeError("Event loop is closed")
    conn.start()
    client = client_of(client_class)

    client.on_connect(client, None, MagicMock(), NOT_AUTHORIZED, None)  # must not raise

    client.disconnect.assert_called_once_with()


def test_refusal_after_stop_reports_nothing(conn, client_class, on_auth_failed):
    conn.start()
    client = client_of(client_class)
    conn.stop([])

    client.on_connect(client, None, MagicMock(), NOT_AUTHORIZED, None)

    on_auth_failed.assert_not_called()


def test_other_refusals_keep_retrying(conn, client_class, on_connected, on_auth_failed, caplog):
    conn.start()
    client = client_of(client_class)

    with caplog.at_level(logging.WARNING):
        client.on_connect(client, None, MagicMock(), SERVER_UNAVAILABLE, None)

    assert not conn.connected
    on_connected.assert_not_called()
    on_auth_failed.assert_not_called()
    client.disconnect.assert_not_called()
    assert "Server unavailable" in caplog.text


def test_callback_errors_do_not_reach_paho(conn, client_class, on_connected, caplog):
    on_connected.side_effect = RuntimeError("Event loop is closed")
    conn.start()
    client = client_of(client_class)

    client.on_connect(client, None, MagicMock(), SUCCESS, None)  # must not raise

    assert conn.connected


def test_disconnect_marks_disconnected_and_warns(conn, client_class, caplog):
    conn.start()
    client = client_of(client_class)
    client.on_connect(client, None, MagicMock(), SUCCESS, None)

    with caplog.at_level(logging.WARNING):
        client.on_disconnect(client, None, MagicMock(), NOT_AUTHORIZED, None)

    assert not conn.connected
    assert "Not authorized" in caplog.text


def test_connect_fail_warns_once_until_connected(conn, client_class, caplog):
    conn.start()
    client = client_of(client_class)

    with caplog.at_level(logging.WARNING):
        client.on_connect_fail(client, None)
        client.on_connect_fail(client, None)
    assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 1

    client.on_connect(client, None, MagicMock(), SUCCESS, None)
    client.on_disconnect(client, None, MagicMock(), SUCCESS, None)
    caplog.clear()
    with caplog.at_level(logging.WARNING):
        client.on_connect_fail(client, None)
    assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 1


def fail_with(client, error: OSError) -> None:
    """Call on_connect_fail the way paho does: inside `except OSError` around reconnect()."""
    try:
        raise error
    except OSError:
        client.on_connect_fail(client, None)


def test_connect_fail_warns_with_reason(conn, client_class, caplog):
    conn.start()
    client = client_of(client_class)

    with caplog.at_level(logging.WARNING):
        fail_with(client, ssl.SSLCertVerificationError("certificate verify failed"))

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "certificate verify failed" in warnings[0].getMessage()


def test_connect_fail_warns_again_when_reason_changes(conn, client_class, caplog):
    conn.start()
    client = client_of(client_class)

    with caplog.at_level(logging.WARNING):
        fail_with(client, ConnectionRefusedError(111, "Connection refused"))
        fail_with(client, ConnectionRefusedError(111, "Connection refused"))
        fail_with(client, OSError(-2, "Name or service not known"))

    messages = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert len(messages) == 2
    assert "Connection refused" in messages[0]
    assert "Name or service not known" in messages[1]


def test_publish_dropped_while_disconnected(conn, client_class):
    conn.publish("gw/x/ha/devices", b"{}")  # before start: no client, dropped

    conn.start()
    client = client_of(client_class)
    conn.publish("gw/x/ha/devices", b"{}")
    client.publish.assert_not_called()

    client.on_connect(client, None, MagicMock(), SUCCESS, None)
    client.publish.reset_mock()
    conn.publish("gw/x/ha/devices", b"{}")
    client.publish.assert_called_once_with("gw/x/ha/devices", b"{}", qos=1, retain=True)

    client.on_disconnect(client, None, MagicMock(), SUCCESS, None)
    client.publish.reset_mock()
    conn.publish("gw/x/ha/devices", b"{}")
    client.publish.assert_not_called()


def test_stop_publishes_waits_and_disconnects(conn, client_class):
    conn.start()
    client = client_of(client_class)
    client.on_connect(client, None, MagicMock(), SUCCESS, None)
    client.publish.reset_mock()
    order = MagicMock()
    client.publish.side_effect = lambda *a, **k: order.publish(*a, **k)
    order.publish.return_value.wait_for_publish = order.wait
    client.disconnect.side_effect = order.disconnect
    client.loop_stop.side_effect = order.loop_stop

    conn.stop([("gw/x/ha/status", b"offline"), (CONNECTION_TOPIC, b"0")])

    names = [c[0] for c in order.mock_calls]
    assert names == ["publish", "publish", "wait", "wait", "disconnect", "loop_stop"]
    assert order.publish.call_args_list == [
        call("gw/x/ha/status", b"offline", qos=1, retain=True),
        call(CONNECTION_TOPIC, b"0", qos=1, retain=True),
    ]
    for wait in order.wait.call_args_list:
        assert 0 <= wait.kwargs["timeout"] <= 5
    assert not conn.connected


def test_stop_survives_failed_publish(conn, client_class):
    conn.start()
    client = client_of(client_class)
    client.on_connect(client, None, MagicMock(), SUCCESS, None)
    client.publish.return_value.wait_for_publish.side_effect = RuntimeError("no connection")

    conn.stop([("gw/x/ha/status", b"offline")])

    client.disconnect.assert_called_once_with()
    client.loop_stop.assert_called_once_with()


def test_stop_while_disconnected_skips_publish(conn, client_class):
    conn.start()
    client = client_of(client_class)

    conn.stop([("gw/x/ha/status", b"offline")])

    client.publish.assert_not_called()
    client.disconnect.assert_called_once_with()
    client.loop_stop.assert_called_once_with()


def test_stop_before_start_is_a_no_op(conn, client_class):
    conn.stop([("gw/x/ha/status", b"offline")])
    client_class.assert_not_called()


def test_start_after_stop_does_nothing(conn, client_class):
    # HA may stop while start() still waits for the executor: no client may outlive the stop.
    conn.stop([("gw/x/ha/status", b"offline")])
    conn.start()
    client_class.assert_not_called()


def test_start_twice_creates_one_client(conn, client_class):
    conn.start()
    conn.start()
    client_class.assert_called_once()


def test_late_connect_after_stop_publishes_nothing(conn, client_class, on_connected):
    conn.start()
    client = client_of(client_class)
    conn.stop([("gw/x/ha/status", b"offline")])

    client.on_connect(client, None, MagicMock(), SUCCESS, None)

    client.publish.assert_not_called()
    on_connected.assert_not_called()
    assert not conn.connected


# Real paho ---------------------------------------------------------------------------------

WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class FakeWebsocketBroker:
    """Accepts MQTT over WebSocket and answers every CONNECT with a fixed CONNACK return code."""

    def __init__(self, return_code: int) -> None:
        self.return_code = return_code
        self.requests: list[str] = []  # HTTP request lines of the WebSocket handshakes
        self.connects: list[bytes] = []  # raw MQTT CONNECT packets
        self._server = socket.create_server(("127.0.0.1", 0))
        self._server.settimeout(0.1)
        self.port = self._server.getsockname()[1]
        self._closing = threading.Event()
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._closing.set()
        self._thread.join(timeout=5)
        self._server.close()

    def _serve(self) -> None:
        while not self._closing.is_set():
            try:
                sock, _ = self._server.accept()
            except TimeoutError:
                continue
            with sock, contextlib.suppress(OSError):  # the client went away
                sock.settimeout(5)
                self._handle(sock)

    def _handle(self, sock: socket.socket) -> None:
        request = b""
        while b"\r\n\r\n" not in request:
            chunk = sock.recv(1024)
            if not chunk:
                return
            request += chunk
        head = request.decode("latin-1")
        self.requests.append(head.split("\r\n", 1)[0])
        key = next(
            line.split(":", 1)[1].strip()
            for line in head.split("\r\n")
            if line.lower().startswith("sec-websocket-key:")
        )
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        sock.sendall(
            (
                "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
                f"Connection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
            ).encode()
        )
        self.connects.append(self._read_frame(sock))
        sock.sendall(bytes([0x82, 4, 0x20, 0x02, 0x00, self.return_code]))  # binary: CONNACK
        while not self._closing.is_set() and sock.recv(1024):  # until the client closes
            pass

    @staticmethod
    def _read_frame(sock: socket.socket) -> bytes:
        def read(n: int) -> bytes:
            data = b""
            while len(data) < n:
                chunk = sock.recv(n - len(data))
                if not chunk:
                    raise ConnectionError("closed")
                data += chunk
            return data

        _opcode, length = read(2)
        length &= 0x7F
        if length == 126:
            length = int.from_bytes(read(2))
        elif length == 127:
            length = int.from_bytes(read(8))
        mask = read(4)
        return bytes(b ^ mask[i % 4] for i, b in enumerate(read(length)))


@pytest.fixture
def broker(request) -> Iterator[FakeWebsocketBroker]:
    broker = FakeWebsocketBroker(request.param)
    yield broker
    broker.close()


def _wait_until(condition, seconds: float = 5) -> None:
    deadline = time.monotonic() + seconds
    while not condition() and time.monotonic() < deadline:
        time.sleep(0.05)


@pytest.mark.usefixtures("socket_enabled")
@pytest.mark.parametrize("broker", [5], indirect=True)  # 5 = not authorised (MQTT 3.1.1)
def test_real_client_stops_after_refused_key(broker, on_connected, on_auth_failed, caplog):
    conn = make_conn(on_connected, on_auth_failed, mqtt_url=f"ws://127.0.0.1:{broker.port}/mqtt")
    with caplog.at_level(logging.DEBUG):
        conn.start()
        _wait_until(lambda: on_auth_failed.called)
        time.sleep(2.5)  # paho would have reconnected after 1 s
        started = time.monotonic()
        conn.stop([("gw/x/ha/status", b"offline")])

    on_auth_failed.assert_called_once_with()
    on_connected.assert_not_called()
    assert broker.requests == ["GET /mqtt HTTP/1.1"]
    assert len(broker.connects) == 1
    assert CLIENT_ID.encode() in broker.connects[0]
    assert GW.encode() in broker.connects[0]
    assert "Not authorized" in caplog.text
    assert PASSWORD not in caplog.text
    assert time.monotonic() - started < 5


@pytest.mark.usefixtures("socket_enabled")
@pytest.mark.parametrize("broker", [3], indirect=True)  # 3 = server unavailable
def test_real_client_keeps_retrying_other_refusals(broker, on_connected, on_auth_failed):
    conn = make_conn(on_connected, on_auth_failed, mqtt_url=f"ws://127.0.0.1:{broker.port}/mqtt")
    conn.start()
    _wait_until(lambda: len(broker.connects) >= 2)
    conn.stop([])

    assert len(broker.connects) >= 2
    on_auth_failed.assert_not_called()
    on_connected.assert_not_called()


@pytest.mark.usefixtures("socket_enabled")  # paho needs a loopback socket pair
def test_real_client_without_broker_starts_and_stops(on_connected, on_auth_failed, caplog):
    """Real paho wiring (no patch): nothing listens on the port, so it retries until stopped."""
    conn = make_conn(on_connected, on_auth_failed, mqtt_url="ws://127.0.0.1:1/mqtt")
    with caplog.at_level(logging.WARNING):
        conn.start()
        _wait_until(lambda: "Cannot reach" in caplog.text)
        conn.publish("gw/x/ha/devices", b"{}")  # dropped, must not raise
        started = time.monotonic()
        conn.stop([("gw/x/ha/status", b"offline")])

    assert "Cannot reach" in caplog.text
    assert "Connection refused" in caplog.text  # paho's reason, not just "cannot reach"
    assert time.monotonic() - started < 5
    assert not conn.connected
    on_connected.assert_not_called()
    on_auth_failed.assert_not_called()
