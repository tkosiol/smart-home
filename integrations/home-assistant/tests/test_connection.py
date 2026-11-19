"""PahoConnection tests with a patched paho client (spec 4.2). No broker, no network."""

from __future__ import annotations

import datetime as dt
import logging
import ssl
import time
from unittest.mock import MagicMock, call, patch

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from paho.mqtt import client as mqtt
from paho.mqtt.enums import CallbackAPIVersion
from paho.mqtt.packettypes import PacketTypes
from paho.mqtt.reasoncodes import ReasonCode

from custom_components.smart_bridge import connection as connection_module
from custom_components.smart_bridge.connection import PahoConnection

GW = "gw-abcdefgh"
CONNECTION_TOPIC = f"gw/{GW}/bridge/connection"
SUCCESS = ReasonCode(PacketTypes.CONNACK, "Success")
NOT_AUTHORIZED = ReasonCode(PacketTypes.CONNACK, "Not authorized")


@pytest.fixture
def client_class():
    with patch("paho.mqtt.client.Client", autospec=True) as client_class:
        yield client_class


@pytest.fixture
def tls_context():
    context = object()
    with patch.object(connection_module, "_tls_context", return_value=context) as factory:
        factory.context = context
        yield factory


@pytest.fixture
def on_connected():
    return MagicMock()


@pytest.fixture
def conn(client_class, tls_context, on_connected) -> PahoConnection:
    return PahoConnection(
        gateway_id=GW,
        host="broker.example.org",
        port=8883,
        ca_file="/certs/ca.crt",
        cert_file="/certs/gateway.crt",
        key_file="/certs/gateway.key",
        on_connected=on_connected,
    )


def client_of(client_class) -> MagicMock:
    return client_class.return_value


def test_start_configures_client(conn, client_class, tls_context):
    client_class.assert_not_called()  # nothing blocking before start()

    conn.start()

    client_class.assert_called_once_with(
        callback_api_version=CallbackAPIVersion.VERSION2,
        client_id=f"{GW}-ha",
        protocol=mqtt.MQTTv311,
    )
    client = client_of(client_class)
    tls_context.assert_called_once_with("/certs/ca.crt", "/certs/gateway.crt", "/certs/gateway.key")
    client.tls_set_context.assert_called_once_with(tls_context.context)
    client.will_set.assert_called_once_with(CONNECTION_TOPIC, b"0", qos=1, retain=True)
    client.reconnect_delay_set.assert_called_once_with(min_delay=1, max_delay=60)
    client.connect_async.assert_called_once_with("broker.example.org", 8883, keepalive=30)
    client.loop_start.assert_called_once_with()
    assert not conn.connected


def test_on_connect_publishes_online_and_calls_back(conn, client_class, on_connected):
    conn.start()
    client = client_of(client_class)

    client.on_connect(client, None, MagicMock(), SUCCESS, None)

    assert conn.connected
    client.publish.assert_called_once_with(CONNECTION_TOPIC, b"1", qos=1, retain=True)
    on_connected.assert_called_once_with()


def test_failed_connect_warns_with_reason(conn, client_class, on_connected, caplog):
    conn.start()
    client = client_of(client_class)

    with caplog.at_level(logging.WARNING):
        client.on_connect(client, None, MagicMock(), NOT_AUTHORIZED, None)

    assert not conn.connected
    client.publish.assert_not_called()
    on_connected.assert_not_called()
    assert "Not authorized" in caplog.text


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


def _write_identity(tmp_path):
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, GW)])
    now = dt.datetime.now(dt.UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=1))
        .not_valid_after(now + dt.timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    cert_file = tmp_path / "gateway.crt"
    key_file = tmp_path / "gateway.key"
    cert_file.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_file.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )
    return str(cert_file), str(key_file)


def test_tls_context_is_tls12_with_client_certificate(tmp_path):
    cert_file, key_file = _write_identity(tmp_path)

    context = connection_module._tls_context(cert_file, cert_file, key_file)

    assert context.minimum_version == ssl.TLSVersion.TLSv1_2
    assert context.maximum_version == ssl.TLSVersion.TLSv1_2
    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname
    assert len(context.get_ca_certs()) == 1


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


@pytest.mark.usefixtures("socket_enabled")  # paho needs a loopback socket pair
def test_real_client_without_broker_starts_and_stops(tmp_path, on_connected, caplog):
    """Real paho wiring (no patch): nothing listens on the port, so it retries until stopped."""
    cert_file, key_file = _write_identity(tmp_path)
    conn = PahoConnection(
        gateway_id=GW,
        host="127.0.0.1",
        port=1,
        ca_file=cert_file,
        cert_file=cert_file,
        key_file=key_file,
        on_connected=on_connected,
    )
    with caplog.at_level(logging.WARNING):
        conn.start()
        deadline = time.monotonic() + 5
        while "Cannot reach" not in caplog.text and time.monotonic() < deadline:
            time.sleep(0.05)
        conn.publish("gw/x/ha/devices", b"{}")  # dropped, must not raise
        started = time.monotonic()
        conn.stop([("gw/x/ha/status", b"offline")])

    assert "Cannot reach" in caplog.text
    assert time.monotonic() - started < 5
    assert not conn.connected
    on_connected.assert_not_called()
