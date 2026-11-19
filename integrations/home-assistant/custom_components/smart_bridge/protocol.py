"""Wire protocol v1 between the integration and the platform (spec 4.3). No HA imports."""

from __future__ import annotations

import datetime as dt
import enum
import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

PROTOCOL_VERSION = 1
DOMAINS = frozenset({"light", "switch", "sensor", "binary_sensor"})
MAX_SNAPSHOT_BYTES = 60 * 1024
MAX_DEVICES_BYTES = 4 * 1024 * 1024
MAX_TEXT_CHARS = 256


@dataclass(frozen=True)
class DeviceInfo:
    id: str
    name: str | None
    manufacturer: str | None
    model: str | None
    area: str | None
    disabled: bool


@dataclass(frozen=True)
class EntityInfo:
    entity_id: str
    device_id: str | None
    domain: str
    device_class: str | None
    name: str | None
    unit: str | None
    capabilities: Mapping[str, Any] | None
    entity_category: str | None  # "config" | "diagnostic" | None
    disabled: bool


@dataclass(frozen=True)
class StateInfo:
    state: str
    attributes: Mapping[str, Any]
    last_updated: str  # ISO 8601 with offset


def topic(gateway_id: str, sub: str) -> str:
    return f"gw/{gateway_id}/ha/{sub}"


def connection_topic(gateway_id: str) -> str:
    return f"gw/{gateway_id}/bridge/connection"


def device_topic(gateway_id: str, device_id: str) -> str:
    return topic(gateway_id, f"device/{device_id}")


def select(
    devices: Iterable[DeviceInfo], entities: Iterable[EntityInfo]
) -> dict[str, list[EntityInfo]]:
    """Entities to publish, per device id: enabled devices with at least one chosen entity."""
    enabled = {d.id for d in devices if not d.disabled}
    chosen: dict[str, list[EntityInfo]] = {}
    for e in entities:
        if (
            e.device_id is not None
            and e.device_id in enabled
            and e.domain in DOMAINS
            and not e.disabled
            and e.entity_category != "config"
        ):
            chosen.setdefault(e.device_id, []).append(e)
    return {
        device_id: sorted(items, key=lambda e: e.entity_id) for device_id, items in chosen.items()
    }


def _default(value: Any) -> Any:
    if isinstance(value, dt.datetime | dt.date):
        return value.isoformat()
    if isinstance(value, set | tuple | frozenset):
        return list(value)
    if isinstance(value, enum.Enum):
        return value.value
    return str(value)


def _dumps(value: Any) -> bytes:
    text = json.dumps(value, separators=(",", ":"), ensure_ascii=False, default=_default)
    return text.encode("utf-8")


def devices_payload(
    devices: Mapping[str, DeviceInfo], selection: Mapping[str, list[EntityInfo]]
) -> bytes | None:
    items = []
    for device_id in sorted(selection):
        device = devices[device_id]
        items.append(
            {
                "id": device.id,
                "name": device.name,
                "manufacturer": device.manufacturer,
                "model": device.model,
                "area": device.area,
                "entities": [
                    {
                        "entity_id": e.entity_id,
                        "domain": e.domain,
                        "device_class": e.device_class,
                        "name": e.name,
                        "unit": e.unit,
                        "capabilities": e.capabilities,
                        "entity_category": e.entity_category,
                    }
                    for e in selection[device_id]
                ],
            }
        )
    payload = _dumps({"v": PROTOCOL_VERSION, "devices": items})
    return payload if len(payload) <= MAX_DEVICES_BYTES else None


def _scalars(attributes: Mapping[str, Any]) -> dict[str, Any]:
    """Keep only short scalar attributes (after JSON conversion of exotic types)."""
    plain = json.loads(_dumps(dict(attributes)))
    return {
        key: value
        for key, value in plain.items()
        if value is None
        or isinstance(value, bool | int | float)
        or (isinstance(value, str) and len(value) <= MAX_TEXT_CHARS)
    }


def snapshot_payload(
    entities: Sequence[EntityInfo], states: Mapping[str, StateInfo | None]
) -> bytes | None:
    present = [(e.entity_id, states.get(e.entity_id)) for e in entities]
    present = [(entity_id, s) for entity_id, s in present if s is not None]

    def build(reduce: bool) -> bytes:
        return _dumps(
            {
                "v": PROTOCOL_VERSION,
                "entities": {
                    entity_id: {
                        "state": s.state,
                        "attributes": _scalars(s.attributes) if reduce else s.attributes,
                        "last_updated": s.last_updated,
                    }
                    for entity_id, s in present
                },
            }
        )

    payload = build(reduce=False)
    if len(payload) <= MAX_SNAPSHOT_BYTES:
        return payload
    payload = build(reduce=True)
    return payload if len(payload) <= MAX_SNAPSHOT_BYTES else None
