"""Setup tests: YAML schema, bridge start after HA started, stop on shutdown (spec 4.1, 4.4)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

from custom_components.smart_bridge import DOMAIN
from custom_components.smart_bridge.bridge import Bridge

from .conftest import FakeConnection

pytestmark = pytest.mark.usefixtures("enable_custom_integrations")

GW = "gw-abcdefgh"


@pytest.fixture
def tls_files(tmp_path: Path) -> dict[str, str]:
    files = {}
    for key in ("ca_file", "cert_file", "key_file"):
        path = tmp_path / f"{key}.pem"
        path.write_text("placeholder", encoding="utf-8")
        files[key] = str(path)
    return files


@pytest.fixture
def config(tls_files: dict[str, str]) -> dict:
    return {
        DOMAIN: {
            "gateway_id": GW,
            "broker_host": "broker.example.org",
            "broker_port": 8883,
            **tls_files,
        }
    }


class RecordingPaho(FakeConnection):
    """Replaces PahoConnection: records its keyword arguments."""

    instances: list[RecordingPaho] = []

    def __init__(self, **kwargs) -> None:
        super().__init__(kwargs.pop("on_connected"))
        self.kwargs = kwargs
        RecordingPaho.instances.append(self)


@pytest.fixture
def paho():
    RecordingPaho.instances = []
    with patch("custom_components.smart_bridge.PahoConnection", RecordingPaho):
        yield RecordingPaho.instances


async def test_valid_config_starts_bridge(hass: HomeAssistant, config, tls_files, paho):
    assert await async_setup_component(hass, DOMAIN, config)
    await hass.async_block_till_done()

    assert isinstance(hass.data[DOMAIN], Bridge)
    assert len(paho) == 1
    connection = paho[0]
    assert connection.kwargs == {
        "gateway_id": GW,
        "host": "broker.example.org",
        "port": 8883,
        **tls_files,
    }
    assert connection.started

    connection.connect()
    await hass.async_block_till_done()
    assert connection.published[-1] == (f"gw/{GW}/ha/status", b"online")


async def test_stop_event_stops_bridge(hass: HomeAssistant, config, paho):
    assert await async_setup_component(hass, DOMAIN, config)
    await hass.async_block_till_done()

    hass.bus.async_fire(EVENT_HOMEASSISTANT_STOP)
    await hass.async_block_till_done()

    assert paho[0].stopped_with == [
        (f"gw/{GW}/ha/status", b"offline"),
        (f"gw/{GW}/bridge/connection", b"0"),
    ]


@pytest.mark.parametrize(
    "gateway_id", ["gw-abc", "gw-ABCDEFGH", "gw-abcdefghi", "xx-abcdefgh", "gw-abcd_fgh", ""]
)
async def test_invalid_gateway_id_fails(hass: HomeAssistant, config, paho, gateway_id):
    config[DOMAIN]["gateway_id"] = gateway_id
    assert not await async_setup_component(hass, DOMAIN, config)
    assert paho == []


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("broker_port", 0),
        ("broker_port", 70000),
        ("ca_file", "/does/not/exist.pem"),
        ("cert_file", "/does/not/exist.pem"),
        ("key_file", "/does/not/exist.pem"),
    ],
)
async def test_invalid_values_fail(hass: HomeAssistant, config, paho, key, value):
    config[DOMAIN][key] = value
    assert not await async_setup_component(hass, DOMAIN, config)
    assert paho == []


@pytest.mark.parametrize(
    "key", ["gateway_id", "broker_host", "broker_port", "ca_file", "cert_file", "key_file"]
)
async def test_missing_key_fails(hass: HomeAssistant, config, paho, key):
    del config[DOMAIN][key]
    assert not await async_setup_component(hass, DOMAIN, config)
    assert paho == []
