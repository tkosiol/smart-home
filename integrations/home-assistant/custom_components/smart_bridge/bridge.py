"""Ties registries, states and the broker connection together (spec 4.4).

Everything here runs in the event loop. The connection's on_connected callback arrives on paho's
thread and hops in with call_soon_threadsafe; blocking connection calls run in the executor.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable

from homeassistant.core import CALLBACK_TYPE, Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.helpers.debounce import Debouncer
from homeassistant.helpers.device_registry import EVENT_DEVICE_REGISTRY_UPDATED
from homeassistant.helpers.entity_registry import EVENT_ENTITY_REGISTRY_UPDATED
from homeassistant.helpers.event import async_track_state_change_event

from . import protocol
from .collector import collect, state_of
from .connection import Connection
from .protocol import DeviceInfo, EntityInfo

_LOGGER = logging.getLogger(__name__)

REGISTRY_COOLDOWN_SECONDS = 2.0
SNAPSHOT_WINDOW_SECONDS = 1.0


class Bridge:
    def __init__(
        self,
        hass: HomeAssistant,
        gateway_id: str,
        connection_factory: Callable[[Callable[[], None]], Connection],
    ) -> None:
        self._hass = hass
        self._status_topic = protocol.topic(gateway_id, "status")
        self._devices_topic = protocol.topic(gateway_id, "devices")
        self._connection_topic = protocol.connection_topic(gateway_id)
        self._gateway_id = gateway_id
        self._connection = connection_factory(self._connected_threadsafe)
        self._devices: dict[str, DeviceInfo] = {}
        self._selection: dict[str, list[EntityInfo]] = {}
        self._device_of: dict[str, str] = {}  # entity_id -> device_id, chosen entities only
        self._unsub_states: CALLBACK_TYPE | None = None
        self._unsub_registry: list[CALLBACK_TYPE] = []
        # Devices that left the selection and whose retained snapshot still needs clearing.
        self._to_clear: set[str] = set()
        # Per device: an open one-second window after a change-driven snapshot, and whether a
        # newer state is waiting for the end of that window.
        self._windows: dict[str, asyncio.TimerHandle] = {}
        self._dirty: set[str] = set()
        self._debouncer: Debouncer[None] = Debouncer(
            hass,
            _LOGGER,
            cooldown=REGISTRY_COOLDOWN_SECONDS,
            immediate=False,
            function=self._async_registry_settled,
        )
        self._stopped = False

    async def async_start(self) -> None:
        """Start after HA has started: select entities, listen for changes, connect."""
        if self._stopped:
            return
        self._async_update_selection()
        for event_type in (EVENT_DEVICE_REGISTRY_UPDATED, EVENT_ENTITY_REGISTRY_UPDATED):
            self._unsub_registry.append(
                self._hass.bus.async_listen(event_type, self._async_registry_event)
            )
        await self._hass.async_add_executor_job(self._connection.start)

    async def async_stop(self) -> None:
        """On HA stop: cancel pending work, publish offline and 0, disconnect."""
        if self._stopped:
            return
        self._stopped = True
        self._debouncer.async_shutdown()
        for unsub in self._unsub_registry:
            unsub()
        self._unsub_registry.clear()
        if self._unsub_states is not None:
            self._unsub_states()
            self._unsub_states = None
        for handle in self._windows.values():
            handle.cancel()
        self._windows.clear()
        self._dirty.clear()
        await self._hass.async_add_executor_job(
            self._connection.stop,
            [(self._status_topic, b"offline"), (self._connection_topic, b"0")],
        )

    # Connection ---------------------------------------------------------------------------

    def _connected_threadsafe(self) -> None:
        """Called on paho's network thread after every successful connect."""
        self._hass.loop.call_soon_threadsafe(self._async_connected)

    @callback
    def _async_connected(self) -> None:
        if self._stopped:
            return
        count = self._async_publish_all()
        self._connection.publish(self._status_topic, b"online")
        _LOGGER.info("Connected; published %d devices", count)

    # Registry changes ---------------------------------------------------------------------

    @callback
    def _async_registry_event(self, _event: Event) -> None:
        self._debouncer.async_schedule_call()

    @callback
    def _async_registry_settled(self) -> None:
        if self._stopped:
            return
        count = self._async_publish_all()
        _LOGGER.debug("Registry changed; published %d devices", count)

    @callback
    def _async_update_selection(self) -> None:
        devices, entities = collect(self._hass)
        selection = protocol.select(devices.values(), entities)
        removed = set(self._selection) - set(selection)
        self._devices, self._selection = devices, selection
        self._to_clear = (self._to_clear | removed) - set(selection)
        for device_id in removed:
            if (handle := self._windows.pop(device_id, None)) is not None:
                handle.cancel()
            self._dirty.discard(device_id)

        device_of = {
            e.entity_id: device_id for device_id, items in selection.items() for e in items
        }
        if device_of.keys() != self._device_of.keys():
            if self._unsub_states is not None:
                self._unsub_states()
                self._unsub_states = None
            if device_of:
                self._unsub_states = async_track_state_change_event(
                    self._hass, sorted(device_of), self._async_state_changed
                )
        self._device_of = device_of

    @callback
    def _async_publish_all(self) -> int:
        """Device list, every snapshot, then empty messages for removed devices."""
        self._async_update_selection()
        payload = protocol.devices_payload(self._devices, self._selection)
        if payload is None:
            _LOGGER.warning(
                "Device list too large (%d devices), not published", len(self._selection)
            )
        else:
            self._connection.publish(self._devices_topic, payload)
        for device_id in sorted(self._selection):
            self._async_publish_snapshot(device_id)
        self._dirty.clear()
        for device_id in sorted(self._to_clear):
            self._connection.publish(protocol.device_topic(self._gateway_id, device_id), b"")
        if self._to_clear and self._connection.connected:
            _LOGGER.debug("Cleared %d removed devices", len(self._to_clear))
            self._to_clear.clear()
        return len(self._selection)

    # State changes ------------------------------------------------------------------------

    @callback
    def _async_state_changed(self, event: Event[EventStateChangedData]) -> None:
        device_id = self._device_of.get(event.data["entity_id"])
        if device_id is None or self._stopped or not self._connection.connected:
            return  # while disconnected nothing is sent; the reconnect sends everything
        if device_id in self._windows:
            self._dirty.add(device_id)
            return
        self._async_publish_snapshot(device_id)
        self._async_open_window(device_id)

    @callback
    def _async_open_window(self, device_id: str) -> None:
        self._windows[device_id] = self._hass.loop.call_later(
            SNAPSHOT_WINDOW_SECONDS, self._async_window_closed, device_id
        )

    @callback
    def _async_window_closed(self, device_id: str) -> None:
        self._windows.pop(device_id, None)
        if self._stopped or device_id not in self._dirty:
            return
        self._dirty.discard(device_id)
        self._async_publish_snapshot(device_id)
        self._async_open_window(device_id)

    @callback
    def _async_publish_snapshot(self, device_id: str) -> None:
        entities = self._selection.get(device_id)
        if not entities:
            return
        states = {e.entity_id: state_of(self._hass, e.entity_id) for e in entities}
        payload = protocol.snapshot_payload(entities, states)
        if payload is None:
            _LOGGER.warning(
                "Snapshot of device %s too large (%d entities), not published",
                device_id,
                len(entities),
            )
            return
        self._connection.publish(protocol.device_topic(self._gateway_id, device_id), payload)
