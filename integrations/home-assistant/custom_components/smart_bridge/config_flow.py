"""Config flow (spec 7): pair with a code from the app; a refused key asks for a new code."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import probatio as vol
from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from . import (
    CONF_CLIENT_ID,
    CONF_GATEWAY_ID,
    CONF_MQTT_URL,
    CONF_PASSWORD,
    CONF_URL,
    CONF_USERNAME,
    DOMAIN,
)
from .pairing import Credentials, PairingError, redeem, validate_app_url

CONF_CODE = "code"

USER_SCHEMA = vol.Schema({vol.Required(CONF_URL): str, vol.Required(CONF_CODE): str})
REAUTH_SCHEMA = vol.Schema({vol.Required(CONF_CODE): str})


def _entry_data(url: str, credentials: Credentials) -> dict[str, str]:
    return {
        CONF_URL: url,
        CONF_GATEWAY_ID: credentials.gateway_id,
        CONF_MQTT_URL: credentials.mqtt_url,
        CONF_USERNAME: credentials.username,
        CONF_PASSWORD: credentials.password,
        CONF_CLIENT_ID: credentials.client_id,
    }


class SmartBridgeConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def _redeem(self, url: str, code: str, expected_gateway_id: str | None) -> Credentials:
        return await redeem(
            async_get_clientsession(self.hass),
            url,
            code,
            self.hass.config.location_name,
            expected_gateway_id,
        )

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                url = validate_app_url(user_input[CONF_URL])
            except ValueError as err:
                errors[CONF_URL] = str(err)
            else:
                try:
                    credentials = await self._redeem(url, user_input[CONF_CODE], None)
                except PairingError as err:
                    errors["base"] = err.reason
                else:
                    await self.async_set_unique_id(credentials.gateway_id)
                    self._abort_if_unique_id_configured()
                    return self.async_create_entry(
                        title=self.hass.config.location_name or credentials.gateway_id,
                        data=_entry_data(url, credentials),
                    )
        return self.async_show_form(
            step_id="user",
            data_schema=self.add_suggested_values_to_schema(USER_SCHEMA, user_input),
            errors=errors,
        )

    async def async_step_reauth(self, _entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        entry = self._get_reauth_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            url = entry.data[CONF_URL]
            gateway_id = entry.data[CONF_GATEWAY_ID]
            try:
                credentials = await self._redeem(url, user_input[CONF_CODE], gateway_id)
            except PairingError as err:
                errors["base"] = err.reason
            else:
                if credentials.gateway_id != gateway_id:
                    errors["base"] = "other_gateway"  # the app checks this; never mix gateways
                else:
                    return self.async_update_reload_and_abort(
                        entry, data=_entry_data(url, credentials)
                    )
        return self.async_show_form(
            step_id="reauth_confirm", data_schema=REAUTH_SCHEMA, errors=errors
        )
