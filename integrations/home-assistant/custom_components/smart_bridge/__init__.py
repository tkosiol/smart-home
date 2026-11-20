"""Smart Home Bridge: publishes Home Assistant devices to the smart home platform.

Set up only through the config flow (pairing code, spec 7); YAML is not supported.
"""

from __future__ import annotations

from collections.abc import Callable

from homeassistant.config_entries import SOURCE_REAUTH, ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.start import async_at_started

from .bridge import Bridge
from .connection import PahoConnection

DOMAIN = "smart_bridge"

# Config entry data (the redeem answer plus the app address)
CONF_URL = "url"
CONF_GATEWAY_ID = "gateway_id"
CONF_MQTT_URL = "mqtt_url"
CONF_USERNAME = "username"
CONF_PASSWORD = "password"
CONF_CLIENT_ID = "client_id"

type SmartBridgeConfigEntry = ConfigEntry[Bridge]


async def async_setup_entry(hass: HomeAssistant, entry: SmartBridgeConfigEntry) -> bool:
    data = entry.data

    @callback
    def _async_abort_reauth() -> None:
        for flow in entry.async_get_active_flows(hass, {SOURCE_REAUTH}):
            hass.config_entries.flow.async_abort(flow["flow_id"])

    # Both run on paho's network thread and hop into the event loop.
    def on_auth_failed() -> None:
        hass.loop.call_soon_threadsafe(entry.async_start_reauth, hass)

    def on_auth_recovered() -> None:
        hass.loop.call_soon_threadsafe(_async_abort_reauth)

    def connection_factory(on_connected: Callable[[], None]) -> PahoConnection:
        return PahoConnection(
            gateway_id=data[CONF_GATEWAY_ID],
            mqtt_url=data[CONF_MQTT_URL],
            username=data[CONF_USERNAME],
            password=data[CONF_PASSWORD],
            client_id=data[CONF_CLIENT_ID],
            on_connected=on_connected,
            on_auth_failed=on_auth_failed,
            on_auth_recovered=on_auth_recovered,
        )

    bridge = Bridge(hass, data[CONF_GATEWAY_ID], connection_factory)
    entry.runtime_data = bridge

    async def _start(_hass: HomeAssistant) -> None:
        await bridge.async_start()

    async def _stop(_event: Event) -> None:
        await bridge.async_stop()

    entry.async_on_unload(async_at_started(hass, _start))
    # Not listen_once: its removal on unload after the event logs an error. Stopping is idempotent.
    entry.async_on_unload(hass.bus.async_listen(EVENT_HOMEASSISTANT_STOP, _stop))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: SmartBridgeConfigEntry) -> bool:
    await entry.runtime_data.async_stop()
    return True
