# Home-Assistant-Integration „Smart Home“ (`smart_bridge`)

Eigene Integration für Home Assistant (Python), die Geräte, Zustände und ihren eigenen Status einer Home-Assistant-Instanz per MQTT an die Plattform meldet. Sie macht Home Assistant zur zweiten Gateway-Art (`ha`) neben Zigbee2MQTT (ADR-0022). Die Integration bleibt bewusst einfach: Sie reicht Registrierung und Zustände unverändert weiter; welche Fähigkeiten, Einheiten und Werte daraus werden, entscheidet der Adapter `ha` im Backend (`apps/backend/src/adapters/ha/`). In dieser Etappe abonniert sie nichts und nimmt keine Befehle an (die folgen mit 6c-3, Vorgabe in Spec Abschnitt 8).

Version 0.2.0. Specs: `docs/superpowers/specs/2026-11-19-home-assistant-adapter-design.md` (Protokoll v1 in Abschnitt 4.3) und `docs/superpowers/specs/2026-11-20-ha-kopplung-design.md` (Kopplung und Verbindung, ADR-0023). Betrieb auf dem Pi: Runbook `docs/runbooks/gateway.md`, Abschnitt 13, und `gateway/README.md`, Abschnitt „Home Assistant“.

## Konfiguration

Nur über die Oberfläche (Config Flow, **kein YAML**): „Einstellungen → Geräte & Dienste → Integration hinzufügen → Smart Home“. Eingegeben werden die **Adresse der App** und ein **Kopplungscode**, den der Eigentümer eines Haushalts in der App erzeugt („Mehr → Gateways → Home Assistant koppeln“; 15 Minuten gültig, einmal einlösbar). Die Integration löst den Code über `POST <adresse>/api/v1/gateway-pairing/redeem` ein, speichert Gateway-ID, Benutzer, Schlüssel und die WebSocket-Adresse im Config Entry (`single_config_entry`: ein Eintrag je Home Assistant) und verbindet sich. Der Name des Gateways kommt vom Standortnamen von Home Assistant.

- **Adressregel:** `https://` immer; `http://` nur für `localhost`, Loopback, IP-Adressen aus privaten Bereichen und Namen ohne Punkt (Heimnetz, Tests), damit der Schlüssel nie im Klartext durchs Internet geht. Die Prüfung nutzt die private-Bereiche-Regel von Python (`ipaddress`): Sie lässt auch Bereiche für Dokumentation und Benchmarks zu und lehnt CGNAT (`100.64.0.0/10`, zum Beispiel Tailscale) ab; dafür `https://` verwenden.
- **Fehler beim Koppeln:** `invalid_code` (unbekannt, abgelaufen oder eingelöst), `limit_reached` (5 Gateways im Haushalt), `unavailable` (die Instanz hat die Kopplung nicht eingerichtet oder der Broker antwortet nicht), `cannot_connect` (Netz, TLS oder eine andere Antwort).
- **Neu koppeln / Reauth:** Lehnt der Broker die Anmeldung ab (gesperrt, neu gekoppelt, Geheimnis geändert), versucht die Integration es zunächst mit der normalen Wartezeit weiter; nach einem Neustart nur des Brokers sind die Zugänge erst nach dem Abgleich des Backends wieder da (höchstens 10 Minuten). **Erst nach 15 Minuten ununterbrochener Ablehnung** startet sie einmal den Ablauf „Erneut authentifizieren“ und meldet sich danach nur noch alle 10 Minuten. Eine spätere gelungene Anmeldung bricht einen offenen Reauth-Ablauf ab (Brokerneustarts heilen sich also selbst). Ein gesperrtes Gateway zeigt den Reauth darum erst nach 15 Minuten. Im Reauth gibt man einen neuen Code für **dasselbe** Gateway ein („Neu koppeln“ in der App); ein Code für ein anderes Gateway wird abgewiesen (`other_gateway`) und nicht verbraucht.

## Verhalten

- **Verbindung:** eigener paho-Client (`paho-mqtt==2.1.0`, im HA-Image enthalten; `manifest.json` nennt die Version, damit HA nichts nachinstalliert), direkt zum Plattform-Broker, nicht über einen lokalen Mosquitto. Client-ID `<gateway_id>-ha`, MQTT 3.1.1, Keepalive 30 s. MQTT über WebSocket (`transport="websockets"`, Pfad aus der Adresse, in der Regel `wss://<app-adresse>/mqtt`) mit Benutzer (Gateway-ID) und Schlüssel; bei `wss` prüft der Standard-`SSLContext` von Home Assistant das Zertifikat mit den System-CAs **und den Hostnamen**. Der Broker bindet die Client-ID an den Benutzer; die Integration nutzt die ID aus der Kopplung.
- **Status:** Last Will `gw/<id>/bridge/connection` = `0`; nach jedem Verbindungsaufbau `1`. `gw/<id>/ha/status` = `online`, sobald Home Assistant gestartet ist und die Geräteliste veröffentlicht wurde; beim Herunterfahren `offline` und `0`, dann trennen (höchstens 5 s).
- **Vollständiger Stand:** Nach jedem Verbindungsaufbau Geräteliste, alle Schnappschüsse und `online`. Alle Nachrichten sind retained (QoS 1). Während der Broker nicht erreichbar ist, wird nichts gepuffert; nach der Wiederverbindung (Pause 1–60 s, wachsend) kommt der vollständige Stand.
- **Registrierung ändert sich:** entprellt mit dem `Debouncer` von Home Assistant (Abklingzeit 2 s): 2 s nach der ersten Änderung, nicht erst nach 2 s Ruhe, kommen Geräteliste und Schnappschüsse neu; danach höchstens einmal je 2 s. Geräte, die nicht mehr dabei sind, bekommen eine leere retained Nachricht (löscht ihren Retain-Stand).
- **Zustand ändert sich:** Schnappschuss des Geräts, je Gerät höchstens einer pro Sekunde (der letzte Stand gewinnt).
- **Auswahl:** Domänen `light`, `switch`, `sensor`, `binary_sensor`; nur Entitäten mit Gerät, nicht deaktiviert, nicht Kategorie `config`; nur Geräte, die nicht deaktiviert und keine Dienste sind (`entry_type` `service`, z. B. die Sonne) und mindestens eine solche Entität haben.
- **Nutzlasten:** Attribute unverändert, nur nicht endliche Zahlen (`NaN`, `±Infinity`) werden zu `null`. Schnappschuss höchstens 60 KiB (sonst Attribute auf skalare Werte gekürzt, notfalls nicht veröffentlicht), Geräteliste höchstens 4 MiB.
- **Log:** Nutzlasten werden nie geloggt. Scheitert der Verbindungsaufbau, steht der Grund (von paho bzw. dem Betriebssystem, z. B. `certificate verify failed`, DNS, abgelehnt) als Warnung im Log, bei gleichem Grund nur einmal.

## Wann ein Update der Integration nötig ist

Nur bei einer neuen Domäne oder einer Änderung des Protokolls. Neue Fähigkeiten aus bereits weitergereichten Entitäten entstehen im Backend-Adapter (normaler Deploy der Plattform). Eine Änderung am Protokoll beginnt in `fixtures/` (siehe unten). Auf dem Pi bringt `pnpm gateway:deploy` die Integration mit; Home Assistant startet dabei neu.

## Verteilung (HACS)

HACS braucht die Integration unter `custom_components/<domain>/` in der Wurzel eines eigenen Repositorys. Darum spiegelt der Workflow `.github/workflows/ha-integration-release.yml` bei jedem Merge auf `main`, der `integrations/home-assistant/**` ändert (nach grünen Tests), `custom_components/smart_bridge/`, `hacs.json` und die Anleitung (`release/`) in das öffentliche Repository `tkosiol/smart-home-hacs` und legt ein Release `v<version>` an, wenn die Version in `manifest.json` noch keines hat (Skript `release/sync-mirror.sh`, Test: `bash integrations/home-assistant/release/test/sync-mirror-test.sh`). Zugang: Actions-Secret `HACS_MIRROR_TOKEN` (Fine-grained, `contents: write` nur auf dem Spiegel); ohne Token endet der Job mit einem Hinweis. Wer Home Assistant installiert: in HACS das benutzerdefinierte Repository `https://github.com/tkosiol/smart-home-hacs` (Kategorie Integration) hinzufügen. Einrichtung durch Till: `docs/runbooks/gateway.md`, Abschnitt 13.

## Aufbau

- `custom_components/smart_bridge/protocol.py`: reiner Protokollteil ohne Home-Assistant-Importe (Topics, Auswahl, Nutzlasten, Kürzung).
- `custom_components/smart_bridge/collector.py`: liest Geräte- und Entitätsregistrierung sowie Zustände als Eingaben für `protocol.py`.
- `custom_components/smart_bridge/connection.py`: paho-Verbindung zum Broker der Plattform (WebSocket, Anmeldung, Will, Wiederverbindung, Reauth-Auslöser, Veröffentlichungen).
- `custom_components/smart_bridge/config_flow.py`, `pairing.py`: Config Flow (Benutzer und Reauth), Adressregel und Einlösen des Codes.
- `custom_components/smart_bridge/bridge.py`: Ablauf nach Spec 4.4 (Start, Ereignisse, Entprellen, Stopp).
- `custom_components/smart_bridge/__init__.py`: `async_setup_entry` startet die Bridge, sobald Home Assistant gestartet ist, `async_unload_entry` stoppt sie.
- `custom_components/smart_bridge/manifest.json`: Manifest der Integration.
- `fixtures/`: Protokoll-Beispiele; der Vertrag zum Backend-Adapter (siehe `fixtures/README.md`). Integration und Backend testen gegen dieselben Dateien.
- `tests/`: pytest-Tests; `test/run-tests.sh`: Testlauf in Docker.
- `pyproject.toml`: nur Konfiguration für ruff und pytest, kein Paketbau. `requirements-test.txt`: gepinnte Testwerkzeuge (`pytest-homeassistant-custom-component`, `ruff`), aktualisiert von Dependabot.

## Tests

```sh
bash integrations/home-assistant/test/run-tests.sh
```

Nötig ist nur Docker; Python, Home Assistant und ruff laufen in Containern. In der CI läuft derselbe Befehl als Job `ops (ha-integration)`.

1. Phase 1 (Image `python:3.14.10-slim-trixie`) führt `ruff format --check`, `ruff check` und `pytest` aus. `pytest-homeassistant-custom-component` 0.13.375 bringt eine HA-Testumgebung mit (HA 2026.10.4; für 2026.11 gibt es noch keine Ausgabe). Ein pip-Cache liegt im Docker-Volume `smart-ha-integration-pip-cache`.
2. Phase 2 startet die Integration im gepinnten Home-Assistant-Image (`ghcr.io/home-assistant/home-assistant:2026.11.0`, einmaliges Laden, groß) gegen das echte Broker-Image aus `infra/broker` (WebSocket-Listener, echte ACL, Dynamic Security; ein per `$CONTROL` angelegter Benutzer). Der Config Entry liegt vorab in `.storage` (abgeleitet aus dem Quelltext von HA 2026.11.0, nicht über einen Config Flow erzeugt); die Testkonfiguration `test/ha-config/configuration.yaml` lädt `demo:` für Demo-Lampen mit Gerät und enthält keinen `smart_bridge`-Block. Geprüft werden innerhalb von 180 s: `bridge/connection` = `1`, `ha/status` = `online`, `ha/devices` (`v` = 1, ein Gerät mit `light`-Entität) und `ha/device/<id>`; nach `docker stop` `offline` und `0`; im HA-Log keine `ERROR`-Zeile von `smart_bridge` und keine Nutzlast. Das beweist Import, Anmeldung, ACL und Python-Version des Images. Bei einem Fehler zeigt der Test die letzten Log-Zeilen von Home Assistant, nie Nutzlasten.
