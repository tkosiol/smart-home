"""Bridge tests: real HA registries and states, a fake broker connection (spec 4.4)."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import timedelta

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed

from custom_components.smart_bridge import protocol
from custom_components.smart_bridge.bridge import Bridge

from .conftest import FakeConnection

GW = "gw-abcdefgh"
DEVICES_TOPIC = f"gw/{GW}/ha/devices"
STATUS_TOPIC = f"gw/{GW}/ha/status"
CONNECTION_TOPIC = f"gw/{GW}/bridge/connection"


@dataclass
class Home:
    entry: MockConfigEntry
    lamp: str
    door: str
    blind: str


@pytest.fixture
async def home(hass: HomeAssistant) -> Home:
    """A lamp (light), a door (binary_sensor) and a device with only a cover."""
    entry = MockConfigEntry(domain="test")
    entry.add_to_hass(hass)
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    living_room = ar.async_get(hass).async_create("Wohnzimmer")

    lamp = devices.async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={("test", "lamp")},
        name="Stehlampe",
        manufacturer="Yeelight",
        model="color4",
    )
    devices.async_update_device(lamp.id, area_id=living_room.id)
    entities.async_get_or_create(
        "light",
        "test",
        "lamp",
        suggested_object_id="stehlampe",
        config_entry=entry,
        device_id=lamp.id,
        capabilities={"supported_color_modes": ["color_temp"]},
    )
    door = devices.async_get_or_create(
        config_entry_id=entry.entry_id, identifiers={("test", "door")}, name="Flurtür"
    )
    entities.async_get_or_create(
        "binary_sensor",
        "test",
        "door",
        suggested_object_id="flur_tuer",
        config_entry=entry,
        device_id=door.id,
        original_device_class="door",
    )
    blind = devices.async_get_or_create(
        config_entry_id=entry.entry_id, identifiers={("test", "blind")}, name="Rollo"
    )
    entities.async_get_or_create(
        "cover",
        "test",
        "blind",
        suggested_object_id="rollo",
        config_entry=entry,
        device_id=blind.id,
    )

    hass.states.async_set("light.stehlampe", "on", {"brightness": 128})
    hass.states.async_set("binary_sensor.flur_tuer", "off", {"device_class": "door"})
    hass.states.async_set("cover.rollo", "open")
    await hass.async_block_till_done()
    return Home(entry=entry, lamp=lamp.id, door=door.id, blind=blind.id)


@pytest.fixture
async def running(hass, home, connection_factory, connections):
    """A started bridge and its fake connection; stopped at teardown (no lingering timers)."""
    bridge = Bridge(hass, GW, connection_factory)
    await bridge.async_start()
    await hass.async_block_till_done()
    yield bridge, connections[-1]
    await bridge.async_stop()


async def connect(hass, connection: FakeConnection) -> list[tuple[str, bytes]]:
    connection.connect()
    await hass.async_block_till_done()
    return connection.take()


async def advance(hass, seconds: float) -> None:
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=seconds))
    await hass.async_block_till_done()


def device_topic(device_id: str) -> str:
    return f"gw/{GW}/ha/device/{device_id}"


def snapshot_states(payload: bytes) -> dict[str, str]:
    return {entity_id: s["state"] for entity_id, s in json.loads(payload)["entities"].items()}


async def test_full_state_after_connect(hass, home, running, caplog):
    _, connection = running
    assert connection.started
    assert connection.take() == []

    published = await connect(hass, connection)
    assert "deprecated" not in caplog.text  # e.g. using the device registry as a mapping

    topics = [topic for topic, _ in published]
    assert topics[0] == DEVICES_TOPIC
    assert sorted(topics[1:3]) == sorted([device_topic(home.lamp), device_topic(home.door)])
    assert topics[3:] == [STATUS_TOPIC]
    assert published[3][1] == b"online"

    devices = json.loads(published[0][1])
    assert devices["v"] == protocol.PROTOCOL_VERSION
    by_name = {d["name"]: d for d in devices["devices"]}
    assert set(by_name) == {"Stehlampe", "Flurtür"}
    lamp = by_name["Stehlampe"]
    assert lamp["id"] == home.lamp
    assert lamp["manufacturer"] == "Yeelight"
    assert lamp["model"] == "color4"
    assert lamp["area"] == "Wohnzimmer"
    assert lamp["entities"] == [
        {
            "entity_id": "light.stehlampe",
            "domain": "light",
            "device_class": None,
            "name": None,
            "unit": None,
            "capabilities": {"supported_color_modes": ["color_temp"]},
            "entity_category": None,
        }
    ]
    assert by_name["Flurtür"]["entities"][0]["device_class"] == "door"
    assert by_name["Flurtür"]["area"] is None

    snapshots = dict(published[1:3])
    lamp_snapshot = json.loads(snapshots[device_topic(home.lamp)])
    entity = lamp_snapshot["entities"]["light.stehlampe"]
    assert entity["state"] == "on"
    assert entity["attributes"] == {"brightness": 128}
    assert entity["last_updated"] == hass.states.get("light.stehlampe").last_updated.isoformat()
    assert entity["last_updated"].endswith("+00:00")
    assert snapshot_states(snapshots[device_topic(home.door)]) == {"binary_sensor.flur_tuer": "off"}


async def test_state_change_publishes_one_snapshot(hass, home, running):
    _, connection = running
    await connect(hass, connection)

    hass.states.async_set("light.stehlampe", "off")
    await hass.async_block_till_done()

    published = connection.take()
    assert [topic for topic, _ in published] == [device_topic(home.lamp)]
    assert snapshot_states(published[0][1]) == {"light.stehlampe": "off"}

    # Entities outside the selection change nothing.
    await advance(hass, 1.1)
    hass.states.async_set("cover.rollo", "closed")
    await hass.async_block_till_done()
    assert connection.take() == []


async def test_snapshots_limited_to_one_per_second(hass, home, running):
    _, connection = running
    await connect(hass, connection)

    for brightness in (10, 20, 30):
        hass.states.async_set("light.stehlampe", "on", {"brightness": brightness})
        await hass.async_block_till_done()

    published = connection.take()
    assert len(published) == 1
    first = json.loads(published[0][1])["entities"]["light.stehlampe"]
    assert first["attributes"] == {"brightness": 10}

    await advance(hass, 1.1)
    published = connection.take()
    assert [topic for topic, _ in published] == [device_topic(home.lamp)]
    last = json.loads(published[0][1])["entities"]["light.stehlampe"]
    assert last["attributes"] == {"brightness": 30}

    # Nothing pending: the window closes without another snapshot; the next change is immediate.
    await advance(hass, 1.1)
    assert connection.take() == []
    await advance(hass, 1.1)
    hass.states.async_set("light.stehlampe", "off")
    await hass.async_block_till_done()
    assert len(connection.take()) == 1


async def test_devices_throttled_independently(hass, home, running):
    _, connection = running
    await connect(hass, connection)

    hass.states.async_set("light.stehlampe", "off")
    hass.states.async_set("binary_sensor.flur_tuer", "on", {"device_class": "door"})
    await hass.async_block_till_done()

    topics = sorted(topic for topic, _ in connection.take())
    assert topics == sorted([device_topic(home.lamp), device_topic(home.door)])


async def test_removed_device_is_cleared_after_debounce(hass, home, running):
    _, connection = running
    await connect(hass, connection)

    er.async_get(hass).async_remove("binary_sensor.flur_tuer")
    await hass.async_block_till_done()
    assert connection.take() == []  # debounced, not immediate

    await advance(hass, 1.0)
    assert connection.take() == []

    await advance(hass, 2.1)
    published = connection.take()
    topics = [topic for topic, _ in published]
    assert topics == [DEVICES_TOPIC, device_topic(home.lamp), device_topic(home.door)]
    devices = json.loads(published[0][1])["devices"]
    assert [d["id"] for d in devices] == [home.lamp]
    assert published[2][1] == b""

    # The removed entity is no longer tracked.
    await advance(hass, 1.1)
    hass.states.async_set("binary_sensor.flur_tuer", "on", {"device_class": "door"})
    await hass.async_block_till_done()
    assert connection.take() == []


async def test_new_entity_is_published_and_tracked(hass, home, running):
    _, connection = running
    await connect(hass, connection)

    er.async_get(hass).async_get_or_create(
        "sensor",
        "test",
        "lamp-power",
        suggested_object_id="stehlampe_power",
        config_entry=home.entry,
        device_id=home.lamp,
        unit_of_measurement="W",
    )
    hass.states.async_set("sensor.stehlampe_power", "4.2", {"unit_of_measurement": "W"})
    await hass.async_block_till_done()
    assert connection.take() == []

    await advance(hass, 2.1)
    published = connection.take()
    devices = json.loads(published[0][1])["devices"]
    lamp = next(d for d in devices if d["id"] == home.lamp)
    assert [e["entity_id"] for e in lamp["entities"]] == [
        "light.stehlampe",
        "sensor.stehlampe_power",
    ]
    assert all(payload != b"" for _, payload in published)

    await advance(hass, 1.1)
    hass.states.async_set("sensor.stehlampe_power", "5.0", {"unit_of_measurement": "W"})
    await hass.async_block_till_done()
    published = connection.take()
    assert [topic for topic, _ in published] == [device_topic(home.lamp)]
    assert snapshot_states(published[0][1]) == {
        "light.stehlampe": "on",
        "sensor.stehlampe_power": "5.0",
    }


async def test_reconnect_publishes_full_state_again(hass, home, running):
    _, connection = running
    first = await connect(hass, connection)

    connection.disconnect()
    hass.states.async_set("light.stehlampe", "off")
    await hass.async_block_till_done()
    assert connection.take() == []  # dropped while disconnected

    second = await connect(hass, connection)
    assert [topic for topic, _ in second] == [topic for topic, _ in first]
    assert second[-1] == (STATUS_TOPIC, b"online")
    assert snapshot_states(dict(second)[device_topic(home.lamp)]) == {"light.stehlampe": "off"}


async def test_removed_device_cleared_after_reconnect(hass, home, running):
    _, connection = running
    await connect(hass, connection)

    connection.disconnect()
    er.async_get(hass).async_remove("binary_sensor.flur_tuer")
    await advance(hass, 2.1)
    assert connection.take() == []

    published = await connect(hass, connection)
    assert (device_topic(home.door), b"") in published
    assert published[-1] == (STATUS_TOPIC, b"online")


async def test_stop_publishes_offline(hass, home, running):
    bridge, connection = running
    await connect(hass, connection)
    hass.states.async_set("light.stehlampe", "on", {"brightness": 1})
    hass.states.async_set("light.stehlampe", "on", {"brightness": 2})
    er.async_get(hass).async_remove("binary_sensor.flur_tuer")
    await hass.async_block_till_done()
    connection.take()

    await bridge.async_stop()
    await hass.async_block_till_done()

    assert connection.stopped_with == [(STATUS_TOPIC, b"offline"), (CONNECTION_TOPIC, b"0")]
    # Pending snapshot windows and debounced refreshes are cancelled; nothing follows.
    connection.connected = True
    await advance(hass, 5)
    hass.states.async_set("light.stehlampe", "off")
    await hass.async_block_till_done()
    connection.connect()
    await hass.async_block_till_done()
    assert connection.take() == []


async def test_too_big_snapshot_is_skipped_with_warning(hass, home, running, monkeypatch, caplog):
    monkeypatch.setattr(protocol, "MAX_SNAPSHOT_BYTES", 10)
    _, connection = running
    with caplog.at_level(logging.DEBUG, logger="custom_components.smart_bridge"):
        published = await connect(hass, connection)

    assert [topic for topic, _ in published] == [DEVICES_TOPIC, STATUS_TOPIC]
    assert "too large" in caplog.text
    # Logs carry events and counts, never payloads.
    assert "Stehlampe" not in caplog.text
    assert "brightness" not in caplog.text
