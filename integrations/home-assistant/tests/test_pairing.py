"""Redeeming a pairing code and checking the app address (spec 4.1, 4.2, 5.2, 5.5)."""

from __future__ import annotations

import logging

import aiohttp
import pytest
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMocker

from custom_components.smart_bridge.pairing import (
    Credentials,
    PairingError,
    redeem,
    validate_app_url,
)

APP = "https://smart.example.org"
REDEEM_URL = f"{APP}/api/v1/gateway-pairing/redeem"
CODE = "ABCD-EFGH"
PASSWORD = "s3cret-broker-key"
GW = "gw-abcdefgh"
ANSWER = {
    "gatewayId": GW,
    "mqttUrl": "wss://smart.example.org/mqtt",
    "username": GW,
    "password": PASSWORD,
    "clientId": f"{GW}-ha",
}


async def _redeem(hass: HomeAssistant, expected_gateway_id: str | None = None) -> Credentials:
    return await redeem(async_get_clientsession(hass), APP, CODE, "Zuhause", expected_gateway_id)


async def test_redeem_returns_credentials(hass: HomeAssistant, aioclient_mock: AiohttpClientMocker):
    aioclient_mock.post(REDEEM_URL, json=ANSWER)

    credentials = await _redeem(hass)

    assert credentials == Credentials(
        gateway_id=GW,
        mqtt_url="wss://smart.example.org/mqtt",
        username=GW,
        password=PASSWORD,
        client_id=f"{GW}-ha",
    )
    assert PASSWORD not in repr(credentials)
    assert aioclient_mock.call_count == 1
    _method, _url, body, _headers = aioclient_mock.mock_calls[0]
    assert body == {"code": CODE, "name": "Zuhause"}


async def test_reauth_sends_the_expected_gateway(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
):
    aioclient_mock.post(REDEEM_URL, json=ANSWER)

    await _redeem(hass, expected_gateway_id=GW)

    _method, _url, body, _headers = aioclient_mock.mock_calls[0]
    assert body == {"code": CODE, "name": "Zuhause", "expectedGatewayId": GW}


async def test_redeem_without_name_leaves_it_out(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
):
    aioclient_mock.post(REDEEM_URL, json=ANSWER)

    await redeem(async_get_clientsession(hass), APP, CODE, None, None)

    _method, _url, body, _headers = aioclient_mock.mock_calls[0]
    assert body == {"code": CODE}


@pytest.mark.parametrize(
    ("status", "body", "reason"),
    [
        (404, {"code": "gateway.pairingInvalid"}, "invalid_code"),
        (400, {"code": "validation.failed"}, "invalid_code"),
        (409, {"code": "gateway.pairingOtherGateway"}, "other_gateway"),
        (409, {"code": "gateway.limitReached", "params": {"max": 5}}, "limit_reached"),
        (409, {"code": "something.else"}, "cannot_connect"),
        (503, {"code": "gateway.pairingUnavailable"}, "unavailable"),
        (429, {"code": "rateLimit.exceeded"}, "too_many_attempts"),
        (500, {"code": "internal"}, "cannot_connect"),
        (302, None, "cannot_connect"),
    ],
)
async def test_error_answers(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, status, body, reason
):
    aioclient_mock.post(REDEEM_URL, status=status, json=body)

    with pytest.raises(PairingError) as err:
        await _redeem(hass)

    assert err.value.reason == reason


@pytest.mark.parametrize(
    "exc", [TimeoutError(), aiohttp.ClientConnectionError("refused"), aiohttp.ClientError()]
)
async def test_network_errors_cannot_connect(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, exc
):
    aioclient_mock.post(REDEEM_URL, exc=exc)

    with pytest.raises(PairingError) as err:
        await _redeem(hass)

    assert err.value.reason == "cannot_connect"


@pytest.mark.parametrize(
    "answer",
    [
        "not json",
        b"\xff\xfe not utf-8",
        "[]",
        '{"gatewayId": "gw-abcdefgh"}',
        {**ANSWER, "password": 42},
        {**ANSWER, "password": ""},
        {**ANSWER, "gatewayId": "gw-abc/#"},
        {**ANSWER, "mqttUrl": "https://smart.example.org/mqtt"},
        {**ANSWER, "mqttUrl": "wss:///mqtt"},
        # Credentials never travel in clear text to a public host.
        {**ANSWER, "mqttUrl": "ws://smart.example.org/mqtt"},
    ],
)
async def test_broken_answers_cannot_connect(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, answer
):
    if isinstance(answer, bytes):
        aioclient_mock.post(REDEEM_URL, content=answer)
    elif isinstance(answer, str):
        aioclient_mock.post(REDEEM_URL, text=answer)
    else:
        aioclient_mock.post(REDEEM_URL, json=answer)

    with pytest.raises(PairingError) as err:
        await _redeem(hass)

    assert err.value.reason == "cannot_connect"


async def test_plain_websocket_allowed_for_a_local_broker(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker
):
    aioclient_mock.post(
        "http://localhost:4200/api/v1/gateway-pairing/redeem",
        json={**ANSWER, "mqttUrl": "ws://localhost:4200/mqtt"},
    )

    credentials = await redeem(
        async_get_clientsession(hass), "http://localhost:4200", CODE, None, None
    )

    assert credentials.mqtt_url == "ws://localhost:4200/mqtt"


async def test_neither_code_nor_password_is_logged(
    hass: HomeAssistant, aioclient_mock: AiohttpClientMocker, caplog
):
    aioclient_mock.post(REDEEM_URL, json=ANSWER)
    aioclient_mock.post(f"{APP}/x/api/v1/gateway-pairing/redeem", status=404, json={})

    with caplog.at_level(logging.DEBUG):
        await _redeem(hass)
        with pytest.raises(PairingError):
            await redeem(async_get_clientsession(hass), f"{APP}/x", CODE, "Zuhause", GW)

    assert CODE not in caplog.text
    assert PASSWORD not in caplog.text


@pytest.mark.parametrize(
    ("url", "normalized"),
    [
        ("https://smart.example.org/foo?x", "https://smart.example.org"),
        ("https://smart.example.org/", "https://smart.example.org"),
        ("  https://Smart.Example.org:8443/a/b#frag ", "https://smart.example.org:8443"),
        ("http://10.0.0.5:8080", "http://10.0.0.5:8080"),
        ("http://172.16.5.20/", "http://172.16.5.20"),
        ("http://127.0.0.1:4200", "http://127.0.0.1:4200"),
        ("http://[::1]:4200", "http://[::1]:4200"),
        ("http://[fd00::5]", "http://[fd00::5]"),
        ("http://localhost", "http://localhost"),
        ("http://localhost:4200/", "http://localhost:4200"),
        ("http://web", "http://web"),
    ],
)
def test_validate_app_url_accepts(url, normalized):
    assert validate_app_url(url) == normalized


@pytest.mark.parametrize(
    "url",
    [
        "http://smart.example.org",
        "http://8.8.8.8",
        "http://[2606:4700:4700::1111]",
        "http://web.local",
    ],
)
def test_validate_app_url_rejects_insecure(url):
    with pytest.raises(ValueError, match="^insecure_url$"):
        validate_app_url(url)


@pytest.mark.parametrize(
    "url", ["ftp://x", "smart.example.org", "", "https://", "https://host:99999", "wss://x"]
)
def test_validate_app_url_rejects_invalid(url):
    with pytest.raises(ValueError, match="^invalid_url$"):
        validate_app_url(url)
