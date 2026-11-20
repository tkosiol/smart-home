"""Smart Home Bridge: publishes Home Assistant devices to the smart home platform."""

from __future__ import annotations

from collections.abc import Callable

import homeassistant.helpers.config_validation as cv
import probatio as vol
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import Event, HomeAssistant
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.typing import ConfigType
from homeassistant.util.hass_dict import HassKey

from .bridge import Bridge
from .connection import PahoConnection

DOMAIN = "smart_bridge"
DATA_BRIDGE: HassKey[Bridge] = HassKey(DOMAIN)

CONF_GATEWAY_ID = "gateway_id"
CONF_BROKER_HOST = "broker_host"
CONF_BROKER_PORT = "broker_port"
CONF_CA_FILE = "ca_file"
CONF_CERT_FILE = "cert_file"
CONF_KEY_FILE = "key_file"

GATEWAY_ID_PATTERN = r"^gw-[a-z0-9]{8}$"

CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.Schema(
            {
                vol.Required(CONF_GATEWAY_ID): vol.All(cv.string, vol.Match(GATEWAY_ID_PATTERN)),
                vol.Required(CONF_BROKER_HOST): cv.string,
                vol.Required(CONF_BROKER_PORT): cv.port,
                vol.Required(CONF_CA_FILE): cv.isfile,
                vol.Required(CONF_CERT_FILE): cv.isfile,
                vol.Required(CONF_KEY_FILE): cv.isfile,
            }
        )
    },
    extra=vol.ALLOW_EXTRA,
)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    conf = config[DOMAIN]
    gateway_id: str = conf[CONF_GATEWAY_ID]

    def connection_factory(on_connected: Callable[[], None]) -> PahoConnection:
        return PahoConnection(
            gateway_id=gateway_id,
            host=conf[CONF_BROKER_HOST],
            port=conf[CONF_BROKER_PORT],
            ca_file=conf[CONF_CA_FILE],
            cert_file=conf[CONF_CERT_FILE],
            key_file=conf[CONF_KEY_FILE],
            on_connected=on_connected,
        )

    bridge = Bridge(hass, gateway_id, connection_factory)
    hass.data[DATA_BRIDGE] = bridge

    async def _start(_hass: HomeAssistant) -> None:
        await bridge.async_start()

    async def _stop(_event: Event) -> None:
        await bridge.async_stop()

    async_at_started(hass, _start)
    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, _stop)
    return True
