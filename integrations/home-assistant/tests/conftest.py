"""Shared test helpers: a fake broker connection that records what the bridge publishes."""

from __future__ import annotations

from collections.abc import Callable, Sequence

import pytest


class FakeConnection:
    """Stands in for PahoConnection. Drops publishes while disconnected, like the real one."""

    def __init__(self, on_connected: Callable[[], None]) -> None:
        self._on_connected = on_connected
        self.connected = False
        self.started = False
        self.stopped_with: list[tuple[str, bytes]] | None = None
        self.published: list[tuple[str, bytes]] = []

    def start(self) -> None:
        self.started = True

    def stop(self, offline_payloads: Sequence[tuple[str, bytes]]) -> None:
        self.stopped_with = list(offline_payloads)
        self.connected = False

    def publish(self, topic: str, payload: bytes) -> None:
        if self.connected:
            self.published.append((topic, payload))

    # Test controls ------------------------------------------------------------------------

    def connect(self) -> None:
        """Simulate a successful (re)connection: the callback runs like paho's would."""
        self.connected = True
        self._on_connected()

    def disconnect(self) -> None:
        self.connected = False

    def take(self) -> list[tuple[str, bytes]]:
        """Return and forget everything published so far."""
        published, self.published = self.published, []
        return published


@pytest.fixture
def connections() -> list[FakeConnection]:
    """Every FakeConnection a factory created, in order."""
    return []


@pytest.fixture
def connection_factory(connections: list[FakeConnection]) -> Callable[..., FakeConnection]:
    def factory(on_connected: Callable[[], None]) -> FakeConnection:
        connection = FakeConnection(on_connected)
        connections.append(connection)
        return connection

    return factory
