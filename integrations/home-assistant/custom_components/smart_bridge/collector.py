"""Reads HA registries and states into protocol inputs (spec 4.3). Event loop only."""

from __future__ import annotations

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er

from .protocol import DeviceInfo, EntityInfo, StateInfo


def collect(hass: HomeAssistant) -> tuple[dict[str, DeviceInfo], list[EntityInfo]]:
    areas = ar.async_get(hass)
    devices: dict[str, DeviceInfo] = {}
    # Iterating `devices` yields the entries; using it as a mapping is deprecated (HA 2026.10+).
    for entry in dr.async_get(hass).devices:
        area = areas.async_get_area(entry.area_id) if entry.area_id else None
        devices[entry.id] = DeviceInfo(
            id=entry.id,
            name=entry.name_by_user or entry.name,
            manufacturer=entry.manufacturer,
            model=entry.model,
            area=area.name if area else None,
            disabled=entry.disabled,
        )
    entities = [
        EntityInfo(
            entity_id=entry.entity_id,
            device_id=entry.device_id,
            domain=entry.domain,
            device_class=entry.device_class or entry.original_device_class,
            name=entry.name or entry.original_name,
            unit=entry.unit_of_measurement,
            capabilities=entry.capabilities,
            entity_category=str(entry.entity_category) if entry.entity_category else None,
            disabled=entry.disabled,
        )
        for entry in er.async_get(hass).entities.values()
    ]
    return devices, entities


def state_of(hass: HomeAssistant, entity_id: str) -> StateInfo | None:
    state = hass.states.get(entity_id)
    if state is None:
        return None
    return StateInfo(
        state=state.state,
        attributes=state.attributes,
        last_updated=state.last_updated.isoformat(),
    )
