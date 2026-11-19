# Home-Assistant-Integration (`smart_bridge`)

Eigene Integration für Home Assistant (Python), die Geräte und Zustände einer Home-Assistant-Instanz per MQTT an die Plattform meldet und Befehle entgegennimmt. Sie macht Home Assistant zu einem zweiten Gateway-Typ neben Pi und Zigbee2MQTT.

Das Protokoll (v1: Topics, Nutzlasten, Auswahl der Entitäten, Größengrenzen) steht in der Spec `docs/superpowers/specs/2026-11-19-home-assistant-adapter-design.md`, Abschnitt 4.3.

## Aufbau

- `custom_components/smart_bridge/protocol.py`: reiner Protokollteil ohne Home-Assistant-Importe (Topics, Auswahl, Nutzlasten, Kürzung).
- `custom_components/smart_bridge/collector.py`: liest Geräte- und Entitätsregistrierung sowie Zustände als Eingaben für `protocol.py`.
- `custom_components/smart_bridge/connection.py`: paho-Verbindung zum Broker der Plattform (mTLS mit TLS 1.2, Will, Wiederverbindung 1–60 s, Veröffentlichungen mit QoS 1 und retained).
- `custom_components/smart_bridge/bridge.py`: Ablauf nach Spec 4.4 (vollständiger Stand nach jedem Verbindungsaufbau, Registrierungsänderungen 2 s entprellt, je Gerät höchstens ein Schnappschuss pro Sekunde, geordneter Stopp).
- `custom_components/smart_bridge/__init__.py`: YAML-Schema (Spec 4.1), startet die Bridge, sobald Home Assistant gestartet ist, und stoppt sie beim Herunterfahren.
- `custom_components/smart_bridge/manifest.json`: Manifest der Integration.
- `fixtures/`: Protokoll-Beispiele; der Vertrag zum Backend-Adapter (siehe `fixtures/README.md`). Integration und Backend testen gegen dieselben Dateien.
- `tests/`: pytest-Tests; `test/run-tests.sh`: Testlauf in Docker.
- `pyproject.toml`: nur Konfiguration für ruff und pytest, kein Paketbau.

## Tests

```sh
bash integrations/home-assistant/test/run-tests.sh
```

Der Lauf hat zwei Phasen.

1. Phase 1 braucht nur Docker (Image `python:3.14.10-slim-trixie`) und führt `ruff format --check`, `ruff check` und `pytest` aus. Ein pip-Cache liegt im Docker-Volume `smart-ha-integration-pip-cache`.
2. Phase 2 startet die Integration im gepinnten Home-Assistant-Image (`ghcr.io/home-assistant/home-assistant:2026.11.0`, einmaliges Laden, groß) gegen das echte Broker-Image aus `infra/broker` (mTLS, echte ACL, Wegwerf-PKI aus `infra/pki/pki.sh`). Sie braucht zusätzlich OpenSSL ≥ 3 (Homebrew-Pfade werden gefunden, sonst `SMART_OPENSSL`) und `python3` auf dem Host. Die Testkonfiguration `test/ha-config/configuration.yaml` lädt `demo:` für Demo-Lampen mit Gerät (das Laden per YAML funktioniert in 2026.11.0). Geprüft werden innerhalb von 180 s: `bridge/connection` = `1`, `ha/status` = `online`, `ha/devices` (`v` = 1, ein Gerät mit `light`-Entität) und `ha/device/<id>`; nach `docker stop` `offline` und `0`; im HA-Log keine `ERROR`-Zeile von `smart_bridge` und keine Nutzlast. Bei einem Fehler zeigt der Test die letzten Log-Zeilen von Home Assistant, nie Nutzlasten.
