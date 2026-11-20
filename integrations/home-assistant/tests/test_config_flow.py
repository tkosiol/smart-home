"""Config flow: pairing with a code (spec 4.1) and re-pairing after a refused key (spec 4.2)."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.config_entries import SOURCE_USER, ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers.translation import async_get_translations
from pytest_homeassistant_custom_component.common import MockConfigEntry
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.smart_bridge import DOMAIN

pytestmark = pytest.mark.usefixtures("enable_custom_integrations")

APP = "https://smart.example.org"
REDEEM_URL = f"{APP}/api/v1/gateway-pairing/redeem"
GW = "gw-abcdefgh"
ANSWER = {
    "gatewayId": GW,
    "mqttUrl": "wss://smart.example.org/mqtt",
    "username": GW,
    "password": "key-generation-1",
    "clientId": f"{GW}-ha",
}
ENTRY_DATA = {
    "url": APP,
    "gateway_id": GW,
    "mqtt_url": "wss://smart.example.org/mqtt",
    "username": GW,
    "password": "key-generation-1",
    "client_id": f"{GW}-ha",
}


@pytest.fixture(autouse=True)
def location_name(hass: HomeAssistant) -> str:
    hass.config.location_name = "Ferienhaus"
    return hass.config.location_name


@pytest.fixture
def setup_entry() -> Iterator[AsyncMock]:
    """The flow is tested on its own: setting up the entry does not start a bridge."""
    with (
        patch("custom_components.smart_bridge.async_setup_entry", return_value=True) as setup,
        patch("custom_components.smart_bridge.async_unload_entry", return_value=True),
    ):
        yield setup


async def _start_user_flow(hass: HomeAssistant):
    return await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})


async def test_user_step_shows_form(hass: HomeAssistant):
    result = await _start_user_flow(hass)

    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "user"
    assert result["errors"] == {}
    assert set(result["data_schema"].schema) == {"url", "code"}


async def test_user_step_creates_entry(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, setup_entry
):
    aioclient_mock.post(REDEEM_URL, json=ANSWER)
    result = await _start_user_flow(hass)

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"url": f"{APP}/gateways?x=1", "code": "abcd-efgh"}
    )
    await hass.async_block_till_done()

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Ferienhaus"
    assert result["data"] == ENTRY_DATA
    assert result["result"].unique_id == GW
    _method, url, body, _headers = aioclient_mock.mock_calls[0]
    assert str(url) == REDEEM_URL
    assert body == {"code": "abcd-efgh", "name": "Ferienhaus"}
    setup_entry.assert_called_once()


@pytest.mark.parametrize(
    ("status", "body", "error"),
    [
        (404, {"code": "gateway.pairingInvalid"}, "invalid_code"),
        (409, {"code": "gateway.limitReached"}, "limit_reached"),
        (409, {"code": "gateway.pairingOtherGateway"}, "other_gateway"),
        (503, {"code": "gateway.pairingUnavailable"}, "unavailable"),
        (429, {"code": "rateLimit.exceeded"}, "too_many_attempts"),
        (500, {}, "cannot_connect"),
    ],
)
async def test_user_step_errors(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, setup_entry, status, body, error
):
    aioclient_mock.post(REDEEM_URL, status=status, json=body)
    result = await _start_user_flow(hass)

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"url": APP, "code": "ABCD-EFGH"}
    )

    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "user"
    assert result["errors"] == {"base": error}

    # The form keeps working: a second attempt with a valid answer creates the entry.
    aioclient_mock.clear_requests()
    aioclient_mock.post(REDEEM_URL, json=ANSWER)
    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"url": APP, "code": "ABCD-EFGH"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY


@pytest.mark.parametrize(
    ("url", "error"),
    [("http://smart.example.org", "insecure_url"), ("ftp://smart.example.org", "invalid_url")],
)
async def test_user_step_rejects_url_before_calling(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, url, error
):
    result = await _start_user_flow(hass)

    result = await hass.config_entries.flow.async_configure(
        result["flow_id"], {"url": url, "code": "ABCD-EFGH"}
    )

    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"url": error}
    assert aioclient_mock.call_count == 0


async def test_second_entry_is_refused(hass: HomeAssistant):
    MockConfigEntry(domain=DOMAIN, unique_id=GW, data=ENTRY_DATA).add_to_hass(hass)

    result = await _start_user_flow(hass)

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "single_instance_allowed"


@pytest.fixture
async def loaded_entry(hass: HomeAssistant, setup_entry) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, title="Ferienhaus", unique_id=GW, data=ENTRY_DATA)
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    setup_entry.reset_mock()
    return entry


async def _start_reauth(hass: HomeAssistant, entry: MockConfigEntry):
    entry.async_start_reauth(hass)
    await hass.async_block_till_done()
    flows = hass.config_entries.flow.async_progress_by_handler(DOMAIN)
    assert len(flows) == 1
    return flows[0]


async def test_reauth_updates_and_reloads_entry(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, loaded_entry, setup_entry
):
    aioclient_mock.post(REDEEM_URL, json={**ANSWER, "password": "key-generation-2"})
    flow = await _start_reauth(hass, loaded_entry)
    assert flow["step_id"] == "reauth_confirm"
    result = await hass.config_entries.flow.async_configure(flow["flow_id"])
    assert result["type"] is FlowResultType.FORM
    assert set(result["data_schema"].schema) == {"code"}

    result = await hass.config_entries.flow.async_configure(flow["flow_id"], {"code": "WXYZ-2345"})
    await hass.async_block_till_done()

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reauth_successful"
    assert loaded_entry.data == {**ENTRY_DATA, "password": "key-generation-2"}
    _method, url, body, _headers = aioclient_mock.mock_calls[0]
    assert str(url) == REDEEM_URL
    assert body == {"code": "WXYZ-2345", "name": "Ferienhaus", "expectedGatewayId": GW}
    setup_entry.assert_called_once()  # reloaded with the new key


@pytest.mark.parametrize(
    ("status", "body", "error"),
    [
        (409, {"code": "gateway.pairingOtherGateway"}, "other_gateway"),
        (404, {"code": "gateway.pairingInvalid"}, "invalid_code"),
        (503, {"code": "gateway.pairingUnavailable"}, "unavailable"),
    ],
)
async def test_reauth_errors_stay_in_form(
    hass: HomeAssistant,
    aioclient_mock: AiohttpClientMocker,
    loaded_entry,
    setup_entry,
    status,
    body,
    error,
):
    aioclient_mock.post(REDEEM_URL, status=status, json=body)
    flow = await _start_reauth(hass, loaded_entry)

    result = await hass.config_entries.flow.async_configure(flow["flow_id"], {"code": "WXYZ-2345"})

    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "reauth_confirm"
    assert result["errors"] == {"base": error}
    assert loaded_entry.data == ENTRY_DATA
    setup_entry.assert_not_called()


async def test_reauth_refuses_credentials_of_another_gateway(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, loaded_entry, setup_entry
):
    other = "gw-zzzzzzzz"
    aioclient_mock.post(REDEEM_URL, json={**ANSWER, "gatewayId": other, "username": other})
    flow = await _start_reauth(hass, loaded_entry)

    result = await hass.config_entries.flow.async_configure(flow["flow_id"], {"code": "WXYZ-2345"})

    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "other_gateway"}
    assert loaded_entry.data == ENTRY_DATA


COMPONENT = Path(__file__).parent.parent / "custom_components" / DOMAIN
ERRORS = {
    "invalid_url",
    "insecure_url",
    "invalid_code",
    "other_gateway",
    "limit_reached",
    "unavailable",
    "too_many_attempts",
    "cannot_connect",
}


def _keys(document: dict, prefix: str = "") -> set[str]:
    keys = set()
    for key, value in document.items():
        keys.add(prefix + key)
        if isinstance(value, dict):
            keys |= _keys(value, f"{prefix}{key}.")
    return keys


def test_translations_cover_the_flow():
    strings = json.loads((COMPONENT / "strings.json").read_text(encoding="utf-8"))
    english = json.loads((COMPONENT / "translations" / "en.json").read_text(encoding="utf-8"))
    german = json.loads((COMPONENT / "translations" / "de.json").read_text(encoding="utf-8"))

    assert english == strings
    assert _keys(german) == _keys(strings)
    assert set(strings["config"]["error"]) == ERRORS
    assert set(strings["config"]["step"]["user"]["data"]) == {"url", "code"}
    assert set(strings["config"]["step"]["reauth_confirm"]["data"]) == {"code"}


async def test_home_assistant_loads_the_german_texts(hass: HomeAssistant):
    texts = await async_get_translations(hass, "de", "config", [DOMAIN])

    assert texts[f"component.{DOMAIN}.config.step.user.data.url"] == "Adresse der App"
    assert texts[f"component.{DOMAIN}.config.step.user.data.code"] == "Kopplungscode"
    assert texts[f"component.{DOMAIN}.config.error.other_gateway"].startswith(
        "Dieser Code gehört zu einem anderen Gateway."
    )
