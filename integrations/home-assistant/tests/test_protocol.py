"""Protocol v1 tests: pure Python, no Home Assistant fixtures. See fixtures/README.md."""

import datetime as dt
import enum
import json
from pathlib import Path

import pytest

from custom_components.smart_bridge import protocol
from custom_components.smart_bridge.protocol import DeviceInfo, EntityInfo, StateInfo

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


def fixture(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def device(id_: str, **kw) -> DeviceInfo:
    base = {
        "id": id_,
        "name": None,
        "manufacturer": None,
        "model": None,
        "area": None,
        "disabled": False,
    }
    return DeviceInfo(**{**base, **kw})


def entity(entity_id: str, device_id: str | None, **kw) -> EntityInfo:
    base = {
        "entity_id": entity_id,
        "device_id": device_id,
        "domain": entity_id.split(".")[0],
        "device_class": None,
        "name": None,
        "unit": None,
        "capabilities": None,
        "entity_category": None,
        "disabled": False,
    }
    return EntityInfo(**{**base, **kw})


def state(value: str, attributes: dict, updated: str) -> StateInfo:
    return StateInfo(state=value, attributes=attributes, last_updated=updated)


# Contract inputs: exactly what the fixtures describe ------------------------------------------

LAMP_ID = "0a1b2c3d4e5f60718293a4b5c6d7e8f9"
PLANT_ID = "1b2c3d4e5f60718293a4b5c6d7e8f90a"
DOOR_ID = "2c3d4e5f60718293a4b5c6d7e8f90a1b"

LAMP = entity(
    "light.stehlampe",
    LAMP_ID,
    capabilities={
        "supported_color_modes": ["color_temp", "hs"],
        "min_color_temp_kelvin": 1700,
        "max_color_temp_kelvin": 6500,
    },
)


def plant_sensor(suffix: str, device_class: str, name: str, unit: str, **kw) -> EntityInfo:
    return entity(
        f"sensor.monstera_{suffix}",
        PLANT_ID,
        device_class=device_class,
        name=name,
        unit=unit,
        capabilities={"state_class": "measurement"},
        **kw,
    )


PLANT = [
    plant_sensor("battery", "battery", "Battery", "%", entity_category="diagnostic"),
    plant_sensor("illuminance", "illuminance", "Illuminance", "lx"),
    plant_sensor("moisture", "moisture", "Moisture", "%"),
    plant_sensor("temperature", "temperature", "Temperature", "°F"),
    plant_sensor("temperature_2", "temperature", "Soil temperature", "°C"),
]
DOOR = [
    entity("binary_sensor.flur_tuer", DOOR_ID, device_class="door", name="Flurtür"),
    entity("switch.flur_steckdose", DOOR_ID, device_class="outlet"),
]

DEVICES = {
    LAMP_ID: device(
        LAMP_ID, name="Stehlampe", manufacturer="Yeelight", model="color4", area="Wohnzimmer"
    ),
    PLANT_ID: device(PLANT_ID, name="Monstera", manufacturer="Xiaomi", model="HHCCJCY01"),
    DOOR_ID: device(DOOR_ID, model="Door sensor"),
}

# Things select() must drop; they must not change the contract output.
DROPPED_DEVICES = [
    device("ffff0000ffff0000ffff0000ffff0000", name="Off", disabled=True),
    device("eeee0000eeee0000eeee0000eeee0000", name="Only config"),
]
DROPPED_ENTITIES = [
    entity("cover.garage", LAMP_ID),
    entity("light.disabled", LAMP_ID, disabled=True),
    entity("sensor.stehlampe_config", LAMP_ID, entity_category="config"),
    entity("sensor.orphan", None),
    entity("light.of_disabled_device", "ffff0000ffff0000ffff0000ffff0000"),
    entity("sensor.only_config", "eeee0000eeee0000eeee0000eeee0000", entity_category="config"),
]


def all_entities() -> list[EntityInfo]:
    # Deliberately unordered; select() sorts.
    return [*reversed(PLANT), *DROPPED_ENTITIES, *DOOR[::-1], LAMP]


def all_devices() -> list[DeviceInfo]:
    return [*DROPPED_DEVICES, *DEVICES.values()]


def test_devices_payload_matches_fixture():
    selection = protocol.select(all_devices(), all_entities())
    payload = protocol.devices_payload(DEVICES, selection)
    assert payload is not None
    assert json.loads(payload) == fixture("devices.json")


def snapshot(entities: list[EntityInfo], states: dict[str, StateInfo | None]) -> dict:
    payload = protocol.snapshot_payload(sorted(entities, key=lambda e: e.entity_id), states)
    assert payload is not None
    return json.loads(payload)


def test_snapshot_lamp_on():
    states = {
        "light.stehlampe": state(
            "on",
            {
                "supported_color_modes": ["color_temp", "hs"],
                "min_color_temp_kelvin": 1700,
                "max_color_temp_kelvin": 6500,
                "friendly_name": "Stehlampe",
                "brightness": 128,
                "color_temp_kelvin": 2700,
                "color_mode": "color_temp",
            },
            "2026-11-19T18:03:21.123456+00:00",
        )
    }
    assert snapshot([LAMP], states) == fixture("device-lamp-on.json")


def test_snapshot_lamp_off():
    states = {
        "light.stehlampe": state(
            "off",
            {
                "supported_color_modes": ["color_temp", "hs"],
                "min_color_temp_kelvin": 1700,
                "max_color_temp_kelvin": 6500,
                "friendly_name": "Stehlampe",
                "brightness": None,
                "color_temp_kelvin": None,
                "color_mode": None,
            },
            "2026-11-19T18:05:00.000000+00:00",
        )
    }
    assert snapshot([LAMP], states) == fixture("device-lamp-off.json")


def test_snapshot_lamp_unavailable():
    states = {
        "light.stehlampe": state(
            "unavailable",
            {"friendly_name": "Stehlampe", "supported_color_modes": ["color_temp", "hs"]},
            "2026-11-19T18:06:00.000000+00:00",
        )
    }
    assert snapshot([LAMP], states) == fixture("device-lamp-unavailable.json")


def test_snapshot_plant():
    def attrs(device_class: str, unit: str, name: str) -> dict:
        return {
            "device_class": device_class,
            "unit_of_measurement": unit,
            "state_class": "measurement",
            "friendly_name": name,
        }

    states = {
        "sensor.monstera_battery": state(
            "87", attrs("battery", "%", "Monstera Battery"), "2026-11-19T16:30:00+00:00"
        ),
        "sensor.monstera_illuminance": state(
            "1200", attrs("illuminance", "lx", "Monstera Illuminance"), "2026-11-19T16:45:00+00:00"
        ),
        "sensor.monstera_moisture": state(
            "41.5", attrs("moisture", "%", "Monstera Moisture"), "2026-11-19T17:00:00+00:00"
        ),
        "sensor.monstera_temperature": state(
            "68.0", attrs("temperature", "°F", "Monstera Temperature"), "2026-11-19T16:50:00+00:00"
        ),
        "sensor.monstera_temperature_2": state(
            "19.25",
            attrs("temperature", "°C", "Monstera Soil temperature"),
            "2026-11-19T16:55:00+00:00",
        ),
    }
    assert snapshot(PLANT, states) == fixture("device-plant.json")


def test_snapshot_door():
    states = {
        "binary_sensor.flur_tuer": state(
            "on",
            {"device_class": "door", "friendly_name": "Flurtür"},
            "2026-11-19T12:00:00.000000+00:00",
        ),
        "switch.flur_steckdose": state(
            "off",
            {"device_class": "outlet", "friendly_name": "Flur Steckdose"},
            "2026-11-19T11:00:00.000000+00:00",
        ),
    }
    assert snapshot(DOOR, states) == fixture("device-door.json")


# Selection ------------------------------------------------------------------------------------


def test_select_filters_and_sorts():
    selection = protocol.select(all_devices(), all_entities())
    assert set(selection) == {LAMP_ID, PLANT_ID, DOOR_ID}
    assert [e.entity_id for e in selection[LAMP_ID]] == ["light.stehlampe"]
    assert [e.entity_id for e in selection[PLANT_ID]] == sorted(e.entity_id for e in PLANT)
    assert [e.entity_id for e in selection[DOOR_ID]] == [
        "binary_sensor.flur_tuer",
        "switch.flur_steckdose",
    ]


def test_select_keeps_diagnostic_drops_config():
    dev = device("d1")
    diag = entity("sensor.a", "d1", entity_category="diagnostic")
    conf = entity("sensor.b", "d1", entity_category="config")
    assert protocol.select([dev], [diag, conf]) == {"d1": [diag]}


@pytest.mark.parametrize(
    "ent",
    [
        entity("cover.a", "d1"),
        entity("sensor.a", "d1", disabled=True),
        entity("sensor.a", None),
        entity("sensor.a", "unknown-device"),
    ],
)
def test_select_drops(ent):
    assert protocol.select([device("d1")], [ent]) == {}


def test_select_drops_disabled_device():
    assert protocol.select([device("d1", disabled=True)], [entity("sensor.a", "d1")]) == {}


def test_domains():
    assert set(protocol.DOMAINS) == {"light", "switch", "sensor", "binary_sensor"}


# Topics ---------------------------------------------------------------------------------------


def test_topics():
    assert protocol.topic("gw-x", "devices") == "gw/gw-x/ha/devices"
    assert protocol.connection_topic("gw-x") == "gw/gw-x/bridge/connection"
    assert protocol.device_topic("gw-x", "abc") == "gw/gw-x/ha/device/abc"


# Size limits and JSON -------------------------------------------------------------------------


def test_snapshot_reduced_when_too_big():
    ent = entity("sensor.a", "d1")
    states = {
        "sensor.a": state(
            "1",
            {
                "big": ["x" * 1024] * 70,
                "scalar": 5,
                "flag": True,
                "none": None,
                "short": "ok",
                "long": "y" * (protocol.MAX_TEXT_CHARS + 1),
            },
            "2026-11-19T10:00:00+00:00",
        )
    }
    payload = protocol.snapshot_payload([ent], states)
    assert payload is not None
    assert len(payload) <= protocol.MAX_SNAPSHOT_BYTES
    attributes = json.loads(payload)["entities"]["sensor.a"]["attributes"]
    assert attributes == {"scalar": 5, "flag": True, "none": None, "short": "ok"}


def test_snapshot_long_text_kept_when_small_enough():
    ent = entity("sensor.a", "d1")
    long = "y" * (protocol.MAX_TEXT_CHARS + 1)
    states = {"sensor.a": state("1", {"long": long}, "2026-11-19T10:00:00+00:00")}
    payload = protocol.snapshot_payload([ent], states)
    assert json.loads(payload)["entities"]["sensor.a"]["attributes"] == {"long": long}


def test_snapshot_none_when_not_reducible():
    entities = [entity(f"sensor.e{i}", "d1") for i in range(400)]
    states = {e.entity_id: state("v" * 200, {}, "2026-11-19T10:00:00+00:00") for e in entities}
    assert protocol.snapshot_payload(entities, states) is None


def test_snapshot_leaves_out_entities_without_state():
    a, b = entity("sensor.a", "d1"), entity("sensor.b", "d1")
    states = {"sensor.a": state("1", {}, "2026-11-19T10:00:00+00:00"), "sensor.b": None}
    payload = protocol.snapshot_payload([a, b], states)
    assert list(json.loads(payload)["entities"]) == ["sensor.a"]
    assert protocol.snapshot_payload([b], states) is not None


def test_devices_payload_none_when_too_big(monkeypatch):
    monkeypatch.setattr(protocol, "MAX_DEVICES_BYTES", 100)
    selection = protocol.select(all_devices(), all_entities())
    assert protocol.devices_payload(DEVICES, selection) is None


def test_devices_payload_sorted_by_id():
    selection = protocol.select(all_devices(), all_entities())
    ids = [d["id"] for d in json.loads(protocol.devices_payload(DEVICES, selection))["devices"]]
    assert ids == sorted(ids)


class Color(enum.Enum):
    RED = "red"


def test_json_default_conversions():
    ent = entity("sensor.a", "d1")
    attributes = {
        "when": dt.datetime(2026, 11, 19, 10, 0, tzinfo=dt.UTC),
        "day": dt.date(2026, 11, 19),
        "set": {"a"},
        "tuple": ("a", "b"),
        "frozen": frozenset({1}),
        "enum": Color.RED,
        "other": object,
    }
    states = {"sensor.a": state("1", attributes, "2026-11-19T10:00:00+00:00")}
    payload = protocol.snapshot_payload([ent], states)
    got = json.loads(payload)["entities"]["sensor.a"]["attributes"]
    assert got["when"] == "2026-11-19T10:00:00+00:00"
    assert got["day"] == "2026-11-19"
    assert got["set"] == ["a"]
    assert got["tuple"] == ["a", "b"]
    assert got["frozen"] == [1]
    assert got["enum"] == "red"
    assert got["other"] == str(object)


def test_json_is_compact_and_not_ascii_escaped():
    ent = entity("binary_sensor.flur_tuer", "d1")
    states = {"binary_sensor.flur_tuer": state("on", {"friendly_name": "Flurtür"}, "t")}
    payload = protocol.snapshot_payload([ent], states)
    assert "Flurtür".encode() in payload
    assert b": " not in payload and b", " not in payload


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_floats_become_null(bad):
    ent = entity("sensor.a", "d1")
    attributes = {
        "top": bad,
        "nested": {"deep": [1.5, bad, {"x": bad}]},
        "tuple": (bad, 2),
        "fine": 0.25,
    }
    states = {"sensor.a": state("1", attributes, "2026-11-19T10:00:00+00:00")}
    payload = protocol.snapshot_payload([ent], states)
    assert b"NaN" not in payload and b"Infinity" not in payload
    got = json.loads(payload)["entities"]["sensor.a"]["attributes"]
    assert got == {
        "top": None,
        "nested": {"deep": [1.5, None, {"x": None}]},
        "tuple": [None, 2],
        "fine": 0.25,
    }


def test_non_finite_floats_in_capabilities_become_null():
    ent = entity("sensor.a", "d1", capabilities={"max": float("inf")})
    selection = protocol.select([device("d1")], [ent])
    payload = protocol.devices_payload({"d1": device("d1")}, selection)
    caps = json.loads(payload)["devices"][0]["entities"][0]["capabilities"]
    assert caps == {"max": None}
