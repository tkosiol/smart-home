"""Entry setup: bridge start after HA started, stop on unload and shutdown, reauth (spec 7)."""

from __future__ import annotations

import logging
import threading
from unittest.mock import patch

import pytest
from homeassistant.config_entries import SOURCE_REAUTH, ConfigEntryState
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import CoreState, HomeAssistant
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.smart_bridge import DOMAIN
from custom_components.smart_bridge.bridge import Bridge

from .conftest import FakeConnection

pytestmark = pytest.mark.usefixtures("enable_custom_integrations")

GW = "gw-abcdefgh"
ENTRY_DATA = {
    "url": "https://smart.example.org",
    "gateway_id": GW,
    "mqtt_url": "wss://smart.example.org/mqtt",
    "username": GW,
    "password": "key-generation-1",
    "client_id": f"{GW}-ha",
}


class RecordingPaho(FakeConnection):
    """Replaces PahoConnection: records its keyword arguments."""

    instances: list[RecordingPaho] = []

    def __init__(self, **kwargs) -> None:
        super().__init__(kwargs.pop("on_connected"))
        self.on_auth_failed = kwargs.pop("on_auth_failed")
        self.kwargs = kwargs
        RecordingPaho.instances.append(self)


@pytest.fixture
def paho():
    RecordingPaho.instances = []
    with patch("custom_components.smart_bridge.PahoConnection", RecordingPaho):
        yield RecordingPaho.instances


@pytest.fixture
def entry(hass: HomeAssistant) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, title="Zuhause", unique_id=GW, data=ENTRY_DATA)
    entry.add_to_hass(hass)
    return entry


async def _setup(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()


async def test_setup_entry_starts_bridge(hass: HomeAssistant, entry, paho):
    await _setup(hass, entry)

    assert entry.state is ConfigEntryState.LOADED
    assert isinstance(entry.runtime_data, Bridge)
    assert len(paho) == 1
    connection = paho[0]
    assert connection.kwargs == {
        "gateway_id": GW,
        "mqtt_url": "wss://smart.example.org/mqtt",
        "username": GW,
        "password": "key-generation-1",
        "client_id": f"{GW}-ha",
    }
    assert connection.started

    connection.connect()
    await hass.async_block_till_done()
    assert connection.published[-1] == (f"gw/{GW}/ha/status", b"online")


async def test_bridge_starts_only_after_ha_started(hass: HomeAssistant, entry, paho):
    hass.set_state(CoreState.starting)

    await _setup(hass, entry)
    assert not paho[0].started

    hass.set_state(CoreState.running)
    hass.bus.async_fire("homeassistant_started")
    await hass.async_block_till_done()
    assert paho[0].started


async def test_unload_entry_stops_bridge(hass: HomeAssistant, entry, paho):
    await _setup(hass, entry)
    paho[0].connect()
    await hass.async_block_till_done()

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()

    assert entry.state is ConfigEntryState.NOT_LOADED
    assert paho[0].stopped_with == [
        (f"gw/{GW}/ha/status", b"offline"),
        (f"gw/{GW}/bridge/connection", b"0"),
    ]


async def test_stop_event_stops_bridge(hass: HomeAssistant, entry, paho, caplog):
    await _setup(hass, entry)

    hass.bus.async_fire(EVENT_HOMEASSISTANT_STOP)
    await hass.async_block_till_done()

    assert paho[0].stopped_with == [
        (f"gw/{GW}/ha/status", b"offline"),
        (f"gw/{GW}/bridge/connection", b"0"),
    ]

    # Unloading afterwards (HA does so while stopping) is clean.
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert [r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR] == []


async def test_refused_key_starts_reauth(hass: HomeAssistant, entry, paho):
    await _setup(hass, entry)

    # paho reports the refusal on its own network thread.
    thread = threading.Thread(target=paho[0].on_auth_failed)
    thread.start()
    thread.join()
    await hass.async_block_till_done()

    flows = hass.config_entries.flow.async_progress_by_handler(DOMAIN)
    assert len(flows) == 1
    assert flows[0]["context"]["source"] == SOURCE_REAUTH
    assert flows[0]["context"]["entry_id"] == entry.entry_id


async def test_yaml_configuration_is_ignored(hass: HomeAssistant, paho, caplog):
    config = {
        DOMAIN: {
            "gateway_id": GW,
            "broker_host": "broker.example.org",
            "broker_port": 8883,
            "ca_file": "/smart-secrets/ca.crt",
            "cert_file": "/smart-secrets/gateway.crt",
            "key_file": "/smart-secrets/gateway.key",
        }
    }

    assert await async_setup_component(hass, DOMAIN, config)
    await hass.async_block_till_done()

    assert paho == []
    assert hass.config_entries.async_entries(DOMAIN) == []
    # Home Assistant itself tells the user to remove the block (log line and repair issue).
    assert "does not support YAML setup" in caplog.text
