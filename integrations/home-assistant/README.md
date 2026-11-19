# Home-Assistant-Integration (`smart_bridge`)

Eigene Integration für Home Assistant (Python), die Geräte, Zustände und ihren eigenen Status einer Home-Assistant-Instanz per MQTT an die Plattform meldet. Sie macht Home Assistant zur zweiten Gateway-Art (`ha`) neben Zigbee2MQTT (ADR-0022). Die Integration bleibt bewusst einfach: Sie reicht Registrierung und Zustände unverändert weiter; welche Fähigkeiten, Einheiten und Werte daraus werden, entscheidet der Adapter `ha` im Backend (`apps/backend/src/adapters/ha/`). In dieser Etappe abonniert sie nichts und nimmt keine Befehle an (die folgen mit 6c-3, Vorgabe in Spec Abschnitt 8).

Spec: `docs/superpowers/specs/2026-11-19-home-assistant-adapter-design.md` (Protokoll v1 in Abschnitt 4.3). Betrieb auf dem Pi: Runbook `docs/runbooks/gateway.md`, Abschnitt 13, und `gateway/README.md`, Abschnitt „Home Assistant“.

## Konfiguration

Nur per YAML in der `configuration.yaml` von Home Assistant (eine Einrichtung über die Oberfläche kommt erst mit dem Kopplungscode):

```yaml
smart_bridge:
  gateway_id: gw-abcdefgh # eigene Gateway-ID, Muster gw-[a-z0-9]{8}, CN des Zertifikats
  broker_host: broker.example.org # muss im Server-Zertifikat des Brokers stehen
  broker_port: 8883
  ca_file: /smart/secrets/ca.crt
  cert_file: /smart/secrets/gateway.crt
  key_file: /smart/secrets/gateway.key
```

Auf dem Pi kommen die Werte per `!env_var` aus der Umgebung des Containers (`gateway/homeassistant/configuration.yaml`), die Zertifikate aus `secrets/ha/` (`infra/deploy/provision-ha.sh`). Eine ungültige Gateway-ID oder eine fehlende Datei weist Home Assistant beim Start ab.

## Verhalten

- **Verbindung:** eigener paho-Client (`paho-mqtt==2.1.0`, im HA-Image enthalten; `manifest.json` nennt die Version, damit HA nichts nachinstalliert), direkt zum Plattform-Broker, nicht über einen lokalen Mosquitto. Client-ID `<gateway_id>-ha`, MQTT 3.1.1, Keepalive 30 s. TLS 1.2 mit Client-Zertifikat über einen eigenen `SSLContext`, der das Server-Zertifikat gegen `ca_file` **und den Hostnamen** prüft: Das Zertifikat des Brokers muss `broker_host` tragen.
- **Status:** Last Will `gw/<id>/bridge/connection` = `0`; nach jedem Verbindungsaufbau `1`. `gw/<id>/ha/status` = `online`, sobald Home Assistant gestartet ist und die Geräteliste veröffentlicht wurde; beim Herunterfahren `offline` und `0`, dann trennen (höchstens 5 s).
- **Vollständiger Stand:** Nach jedem Verbindungsaufbau Geräteliste, alle Schnappschüsse und `online`. Alle Nachrichten sind retained (QoS 1). Während der Broker nicht erreichbar ist, wird nichts gepuffert; nach der Wiederverbindung (Pause 1–60 s, wachsend) kommt der vollständige Stand.
- **Registrierung ändert sich:** entprellt mit dem `Debouncer` von Home Assistant (Abklingzeit 2 s): 2 s nach der ersten Änderung, nicht erst nach 2 s Ruhe, kommen Geräteliste und Schnappschüsse neu; danach höchstens einmal je 2 s. Geräte, die nicht mehr dabei sind, bekommen eine leere retained Nachricht (löscht ihren Retain-Stand).
- **Zustand ändert sich:** Schnappschuss des Geräts, je Gerät höchstens einer pro Sekunde (der letzte Stand gewinnt).
- **Auswahl:** Domänen `light`, `switch`, `sensor`, `binary_sensor`; nur Entitäten mit Gerät, nicht deaktiviert, nicht Kategorie `config`; nur Geräte, die nicht deaktiviert und keine Dienste sind (`entry_type` `service`, z. B. die Sonne) und mindestens eine solche Entität haben.
- **Nutzlasten:** Attribute unverändert, nur nicht endliche Zahlen (`NaN`, `±Infinity`) werden zu `null`. Schnappschuss höchstens 60 KiB (sonst Attribute auf skalare Werte gekürzt, notfalls nicht veröffentlicht), Geräteliste höchstens 4 MiB.
- **Log:** Nutzlasten werden nie geloggt. Scheitert der Verbindungsaufbau, steht der Grund (von paho bzw. dem Betriebssystem, z. B. `certificate verify failed`, DNS, abgelehnt) als Warnung im Log, bei gleichem Grund nur einmal.

## Wann ein Update der Integration nötig ist

Nur bei einer neuen Domäne oder einer Änderung des Protokolls. Neue Fähigkeiten aus bereits weitergereichten Entitäten entstehen im Backend-Adapter (normaler Deploy der Plattform). Eine Änderung am Protokoll beginnt in `fixtures/` (siehe unten). Auf dem Pi bringt `pnpm gateway:deploy` die Integration mit; Home Assistant startet dabei neu. Installation über HACS und Einrichtung per Kopplungscode für fremde Installationen kommen später (Spec Abschnitt 9).

## Aufbau

- `custom_components/smart_bridge/protocol.py`: reiner Protokollteil ohne Home-Assistant-Importe (Topics, Auswahl, Nutzlasten, Kürzung).
- `custom_components/smart_bridge/collector.py`: liest Geräte- und Entitätsregistrierung sowie Zustände als Eingaben für `protocol.py`.
- `custom_components/smart_bridge/connection.py`: paho-Verbindung zum Broker der Plattform (mTLS, Will, Wiederverbindung, Veröffentlichungen).
- `custom_components/smart_bridge/bridge.py`: Ablauf nach Spec 4.4 (Start, Ereignisse, Entprellen, Stopp).
- `custom_components/smart_bridge/__init__.py`: YAML-Schema (Spec 4.1), startet die Bridge, sobald Home Assistant gestartet ist, und stoppt sie beim Herunterfahren.
- `custom_components/smart_bridge/manifest.json`: Manifest der Integration.
- `fixtures/`: Protokoll-Beispiele; der Vertrag zum Backend-Adapter (siehe `fixtures/README.md`). Integration und Backend testen gegen dieselben Dateien.
- `tests/`: pytest-Tests; `test/run-tests.sh`: Testlauf in Docker.
- `pyproject.toml`: nur Konfiguration für ruff und pytest, kein Paketbau. `requirements-test.txt`: gepinnte Testwerkzeuge (`pytest-homeassistant-custom-component`, `ruff`), aktualisiert von Dependabot.

## Tests

```sh
bash integrations/home-assistant/test/run-tests.sh
```

Nötig sind nur Docker und für Phase 2 OpenSSL ≥ 3; Python, Home Assistant und ruff laufen in Containern. In der CI läuft derselbe Befehl als Job `ops (ha-integration)`.

1. Phase 1 (Image `python:3.14.10-slim-trixie`) führt `ruff format --check`, `ruff check` und `pytest` aus. `pytest-homeassistant-custom-component` 0.13.375 bringt eine HA-Testumgebung mit (HA 2026.10.4; für 2026.11 gibt es noch keine Ausgabe). Ein pip-Cache liegt im Docker-Volume `smart-ha-integration-pip-cache`.
2. Phase 2 startet die Integration im gepinnten Home-Assistant-Image (`ghcr.io/home-assistant/home-assistant:2026.11.0`, einmaliges Laden, groß) gegen das echte Broker-Image aus `infra/broker` (mTLS, echte ACL, Wegwerf-PKI aus `infra/pki/pki.sh`). OpenSSL ≥ 3 wird über die Homebrew-Pfade gefunden, sonst `SMART_OPENSSL`. Die Testkonfiguration `test/ha-config/configuration.yaml` lädt `demo:` für Demo-Lampen mit Gerät (das Laden per YAML funktioniert in 2026.11.0). Geprüft werden innerhalb von 180 s: `bridge/connection` = `1`, `ha/status` = `online`, `ha/devices` (`v` = 1, ein Gerät mit `light`-Entität) und `ha/device/<id>`; nach `docker stop` `offline` und `0`; im HA-Log keine `ERROR`-Zeile von `smart_bridge` und keine Nutzlast. Das beweist Import, TLS, ACL und Python-Version des Images. Bei einem Fehler zeigt der Test die letzten Log-Zeilen von Home Assistant, nie Nutzlasten.
