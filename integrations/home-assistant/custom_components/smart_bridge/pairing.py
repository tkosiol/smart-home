"""Pairing with the platform (spec 4.1, 4.2, 5.2, 5.5): check the app address, redeem a code.

Only aiohttp, no Home Assistant imports. Neither the code, nor the key, nor an answer is logged.
"""

from __future__ import annotations

import ipaddress
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

import aiohttp

_LOGGER = logging.getLogger(__name__)

REDEEM_PATH = "/api/v1/gateway-pairing/redeem"
TIMEOUT_SECONDS = 15
GATEWAY_ID_PATTERN = re.compile(r"^gw-[a-z0-9]{8}$")

# API error codes of a 409 answer -> flow error
_CONFLICTS = {
    "gateway.pairingOtherGateway": "other_gateway",
    "gateway.limitReached": "limit_reached",
}
# HTTP status -> flow error; 400 only happens for a malformed code. A 404 is a wrong code only
# with the app's own error code: a wrong address may answer 404 too.
_STATUS_ERRORS = {
    400: "invalid_code",
    429: "too_many_attempts",
    503: "unavailable",
}
_INVALID_CODE = "gateway.pairingInvalid"


class PairingError(Exception):
    """Redeeming failed. reason: invalid_code, other_gateway, limit_reached, unavailable,
    too_many_attempts or cannot_connect (also used as the flow's error key)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Credentials:
    gateway_id: str
    mqtt_url: str
    username: str
    password: str = field(repr=False)
    client_id: str


def _is_local_host(host: str) -> bool:
    """localhost, a private or loopback IP address, or a name without a dot (home network)."""
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return "." not in host
    return address.is_private or address.is_loopback


def validate_app_url(url: str) -> str:
    """Return "scheme://host[:port]" of the app address, without path, query and fragment.

    https always; http only for a local host (5.5). ValueError("invalid_url" | "insecure_url").
    """
    try:  # urlsplit, hostname and port raise ValueError with their own messages
        parts = urlsplit(url.strip())
        host = parts.hostname
        port = parts.port
    except ValueError as err:
        raise ValueError("invalid_url") from err
    scheme = parts.scheme.lower()
    if scheme not in ("https", "http") or not host:
        raise ValueError("invalid_url")
    if scheme == "http" and not _is_local_host(host):
        raise ValueError("insecure_url")
    netloc = f"[{host}]" if ":" in host else host
    if port is not None:
        netloc = f"{netloc}:{port}"
    return f"{scheme}://{netloc}"


def _valid_mqtt_url(url: str) -> bool:
    """wss always; ws only to a local host, so the key never travels in clear text."""
    try:
        parts = urlsplit(url)
        host = parts.hostname
        _ = parts.port  # raises ValueError for an invalid port
    except ValueError:
        return False
    if not host:
        return False
    return parts.scheme == "wss" or (parts.scheme == "ws" and _is_local_host(host))


def _credentials_of(document: Any) -> Credentials:
    if not isinstance(document, dict):
        raise PairingError("cannot_connect")
    values = [document.get(key) for key in ("gatewayId", "mqttUrl", "username", "password")]
    values.append(document.get("clientId"))
    if not all(isinstance(value, str) and value for value in values):
        raise PairingError("cannot_connect")
    gateway_id, mqtt_url, username, password, client_id = values
    if not GATEWAY_ID_PATTERN.match(gateway_id) or not _valid_mqtt_url(mqtt_url):
        raise PairingError("cannot_connect")
    return Credentials(
        gateway_id=gateway_id,
        mqtt_url=mqtt_url,
        username=username,
        password=password,
        client_id=client_id,
    )


async def redeem(
    session: aiohttp.ClientSession,
    app_url: str,
    code: str,
    name: str | None,
    expected_gateway_id: str | None,
) -> Credentials:
    """POST the code to the app (app_url from validate_app_url). Raises PairingError."""
    body: dict[str, str] = {"code": code}
    if name is not None:
        body["name"] = name
    if expected_gateway_id is not None:
        body["expectedGatewayId"] = expected_gateway_id
    try:
        async with session.post(
            f"{app_url}{REDEEM_PATH}",
            json=body,
            timeout=aiohttp.ClientTimeout(total=TIMEOUT_SECONDS),
            allow_redirects=False,
        ) as response:
            status = response.status
            raw = await response.read()
    except (aiohttp.ClientError, TimeoutError) as err:
        _LOGGER.warning("Cannot reach the app to pair: %s", str(err) or type(err).__name__)
        raise PairingError("cannot_connect") from err
    try:
        document = json.loads(raw)
    except ValueError:  # also not UTF-8
        document = None

    if status == 200:
        return _credentials_of(document)
    reason = _STATUS_ERRORS.get(status, "cannot_connect")
    error_code = document.get("code") if isinstance(document, dict) else None
    if status == 409:
        reason = _CONFLICTS.get(str(error_code), "cannot_connect")
    elif status == 404 and error_code == _INVALID_CODE:
        reason = "invalid_code"
    _LOGGER.debug("Pairing refused with HTTP %s (%s)", status, reason)
    raise PairingError(reason)
