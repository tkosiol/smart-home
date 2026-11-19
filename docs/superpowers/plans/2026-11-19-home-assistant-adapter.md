# Home-Assistant-Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Home Assistant wird die zweite Gateway-Art (`ha`): eine schlanke HA-Integration `smart_bridge` meldet Geräte, Zustände und Status direkt per mTLS an den Plattform-Broker, der Backend-Adapter `ha` übersetzt sie ins Vokabular, und auf dem Pi läuft HA als optionaler Dienst des Gateway-Pakets.

**Architecture:** Integration in Python unter `integrations/home-assistant/` (reiner Protokollteil + dünne HA-Schicht + paho-Verbindung), Protokoll v1 unter `gw/<id>/ha/…` mit gemeinsamen Beispieldateien als Vertrag zwischen Integration und Backend. Backend-Adapter unter `apps/backend/src/adapters/ha/` nach dem Muster des Z2M-Adapters; der Kern bleibt unverändert bis auf die neue Art (Contracts, Prüfregel per Migration 0012). Pi: Compose-Profil `ha`, Deploy kopiert die Integration, eigenes Provisionierungsskript für die HA-Secrets.

**Tech Stack:** Home Assistant 2026.11.0 (Python 3.14.10, paho-mqtt 2.1.0, `probatio`), pytest + pytest-homeassistant-custom-component 0.13.375 (HA 2026.10.4), ruff; NestJS 12.5, Drizzle 0.45, zod, Vitest + Testcontainers; Angular 22 (`UiSegmentedButton`); Bash-Testsuiten mit Docker.

**Spec:** `docs/superpowers/specs/2026-11-19-home-assistant-adapter-design.md`

## Global Constraints

- Code, Bezeichner, Kommentare, Commits: Englisch; Doku in `docs/`: Deutsch. Conventional Commits mit Scope aus: repo, frontend, backend, contracts, ui, lint, infra, gateway, ci, docs, deps. Für die Integration Scope `gateway` (sie läuft am Rand), für ihre CI `ci`.
- Keine KI-Attribution in Commits (commitlint blockiert `Co-Authored-By: Claude` und „Generated with …“).
- Öffentliches Repo: keine IPs, privaten Hostnamen, E-Mail-Adressen, Secrets. Vor jedem Push: `git grep -nE -f .local/private-patterns.txt -- .` (leer).
- Lint-Regeln nie abschalten; passt eine Regel nicht, wird sie in `tools/lint-config` mit Test angepasst. In Python kein `# noqa` ohne Begründung im selben Kommentar.
- Kein Code in `apps/backend/src/core/` ändert sich (Ausnahme: nichts). Kein HA-Wissen im Kern.
- Pi: Mosquitto, Bridge, `mosquitto.conf.template`, Zigbee2MQTT bleiben unverändert. Ohne `secrets/ha/ha.env` verhalten sich Deploy, Start und Backup genau wie bisher.
- Nutzlasten werden nie protokolliert (weder im Backend noch in der Integration).
- Zeit: speichern/übertragen nur UTC bzw. ISO mit Zone; Backend-Tests laufen zusätzlich mit `TZ=Pacific/Chatham` (`pnpm test:tz`).
- Initiales Frontend-Bundle ≤ 425 kB (Stand rund 415,40 kB): `UiSegmentedButton` kommt aus `@smart/ui/forms` und gehört zur lazy Seite.
- Gepinnte Versionen: HA-Image `ghcr.io/home-assistant/home-assistant:2026.11.0`; `paho-mqtt==2.1.0`; Test-Image `python:3.14.10-slim-trixie` (Tag vor Gebrauch mit `docker manifest inspect` prüfen; fehlt er, den neuesten vorhandenen `3.14.*-slim-trixie` nehmen und das im Bericht nennen); `pytest-homeassistant-custom-component==0.13.375`; `ruff` exakt gepinnt (neueste Version, die mindestens zwei Wochen alt ist).
- Prüfen vor dem Abschluss jedes Tasks: die im Task genannten Tests; bei Änderungen im Node-Teil zusätzlich `pnpm lint && pnpm typecheck` im Repo-Wurzelverzeichnis.
- Backend-Integrationstests brauchen Docker und OpenSSL ≥ 3 (`brew install openssl@3`, wird gefunden).

## Review Focus

1. **Lampe aus und wieder an:** HA meldet bei ausgeschalteter Lampe `brightness: null` und behält `color_temp_kelvin` teils als `null`. Erwartet: `state` = `false`, keine Helligkeits- oder Kelvin-Messung mit 0 oder `null`; beim Einschalten wieder Werte (Task 2).
2. **Gerät verschwindet aus HA** (Lampe in HA gelöscht): Die Integration löscht den retained Schnappschuss (leere Nachricht), der Adapter macht daraus nichts, und die nächste Geräteliste ohne das Gerät entfernt die Hardware wie bei Z2M (Task 2, Task 5, Task 6).
3. **HA startet neu, Broker trennt kurz:** Nach der Wiederverbindung kommt der vollständige Stand erneut; retained Kopien mit gleicher oder älterer Zeit überschreiben keinen neueren Stand im Kern (Task 3, Task 6).
4. **Yeelight vom Strom getrennt:** alle Entitäten `unavailable` → Verfügbarkeit `offline`, keine Messwerte; zurück → `online` (Task 2).
5. **Gleiche Gateway-ID für Z2M und HA versehentlich provisioniert:** `provision-ha.sh` verweigert. Sonst schrieben beide unter derselben Identität, und für einen der beiden passte die Art des Gateways nie (Task 9).

---

## Dateistruktur

| Datei                                                                | Verantwortung                                                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/gateways.ts`                                 | `GATEWAY_KINDS = ['z2m', 'ha']`                                                                     |
| `apps/backend/drizzle/0012_gateway_kind_ha.sql` (+ Snapshot/Journal) | Prüfregel `gateways_kind_check` mit `ha`                                                            |
| `infra/broker/acl`                                                   | `pattern write gw/%u/ha/#`                                                                          |
| `integrations/home-assistant/fixtures/*.json` (neu)                  | Protokoll v1 als Beispiele: Vertrag zwischen Integration und Backend                                |
| `apps/backend/src/adapters/ha/` (neu)                                | `ha.adapter.ts`, `protocol.ts` (Schemas v1), `entities.ts`, `devices.ts`, `decode.ts`, Modul, Index |
| `apps/frontend/src/app/features/gateways/register-form.ts`           | Auswahl der Art                                                                                     |
| `integrations/home-assistant/custom_components/smart_bridge/` (neu)  | Integration: `protocol.py`, `collector.py`, `connection.py`, `bridge.py`, `__init__.py`, Manifest   |
| `integrations/home-assistant/tests/`, `test/` (neu)                  | pytest; `run-tests.sh` (ruff, pytest, Docker-Test mit echtem Image)                                 |
| `gateway/compose.yaml`, `gateway/homeassistant/configuration.yaml`   | Dienst `homeassistant` (Profil `ha`), schlanke HA-Konfiguration                                     |
| `gateway/deploy.sh`, `gateway/start.sh`, `gateway/backup/*`          | Kopie der Integration, Profil-Schalter, Warten auf HA, Backup der HA-Daten                          |
| `infra/deploy/provision-ha.sh` (neu)                                 | HA-Secrets auf den Pi                                                                               |
| `.github/workflows/ci.yml`, `.github/dependabot.yml`                 | Suite `ha-integration`, Updates für pip und `gateway/compose.yaml`                                  |

---

### Task 1: Neue Art `ha` – Contracts, Migration, Broker-ACL

**Files:**

- Modify: `packages/contracts/src/gateways.ts` (`GATEWAY_KINDS`)
- Create: `apps/backend/drizzle/0012_gateway_kind_ha.sql`, Snapshot `apps/backend/drizzle/meta/0012_snapshot.json`, Eintrag in `apps/backend/drizzle/meta/_journal.json`
- Modify: `infra/broker/acl`, Test in `infra/broker/test/broker-test.sh`
- Test: `apps/backend/test/gateways.e2e-spec.ts` (Registrierung mit `kind: 'ha'`), Contracts-Spec zu `gatewayRegisterSchema`

**Interfaces:**

- Produces: `GATEWAY_KINDS` enthält `'ha'`; `GatewayKind = 'z2m' | 'ha'`. Die Datenbank akzeptiert `kind = 'ha'`.

- [ ] **Step 1: Failing tests.** Contracts-Spec: `gatewayRegisterSchema` akzeptiert `kind: 'ha'`, lehnt `kind: 'hue'` ab. Backend-E2E (`gateways.e2e-spec.ts`): Registrierung mit gültigem Zertifikat und `kind: 'ha'` → 201, Antwort `kind: 'ha'`, Zeile in der DB hat `kind = 'ha'`. Broker-Test: ein Gateway-Zertifikat `gw-…` darf auf `gw/<eigene-id>/ha/x` schreiben (der API-Benutzer empfängt es), nicht auf `gw/<fremde-id>/ha/x`, und darf `gw/<eigene-id>/ha/command` nicht lesen (Leserechte kommen erst mit 6c-3).
- [ ] **Step 2: Laufen lassen, Fehlschlag sehen.** `pnpm --filter @smart/contracts test`, `pnpm --filter @smart/backend test -- gateways`, `bash infra/broker/test/broker-test.sh`.
- [ ] **Step 3: Umsetzen.** `GATEWAY_KINDS = ['z2m', 'ha'] as const`. `pnpm packages:build`. Migration mit `pnpm --filter @smart/backend exec drizzle-kit generate --name gateway_kind_ha` erzeugen (erwartet: `ALTER TABLE "gateways" DROP CONSTRAINT "gateways_kind_check"; … ADD CONSTRAINT … CHECK ("gateways"."kind" in ('z2m', 'ha'))`); danach `drizzle-kit generate` erneut → „No schema changes“. ACL: unter der bestehenden `z2m`-Zeile `pattern write gw/%u/ha/#`, Kommentar oben unverändert.
- [ ] **Step 4: Tests grün.** Dieselben Befehle; zusätzlich `pnpm lint && pnpm typecheck`.
- [ ] **Step 5: Commit.** `feat(contracts): add the gateway kind ha` (Contracts + Migration) und `feat(infra): let gateways publish below gw/<id>/ha` (ACL + Test).

---

### Task 2: Protokoll-Beispiele und Backend-Adapter `ha` (rein)

**Files:**

- Create: `integrations/home-assistant/fixtures/devices.json`, `device-lamp-on.json`, `device-lamp-off.json`, `device-lamp-unavailable.json`, `device-plant.json`, `device-door.json`, `README.md` (ein Absatz: Vertrag v1, von beiden Seiten getestet)
- Create: `apps/backend/src/adapters/ha/protocol.ts`, `entities.ts`, `devices.ts`, `decode.ts`, `ha.adapter.ts`, `ha-adapter.module.ts`, `index.ts` mit Specs `*.spec.ts` je Datei
- Test: Specs lesen die Beispieldateien per `readFileSync(new URL('../../../../../integrations/home-assistant/fixtures/<name>.json', import.meta.url))` (Pfad im Bericht prüfen)

**Interfaces:**

- Consumes: `GatewayAdapter`, `AdapterEvent`, `ReportedHardware`, `ReportedCapability`, `StoredCapability`, `DecodedReport` aus `../../core/adapters/index.js`; `vocabularyEntry`, `CAPABILITY_KEY_PATTERN` aus `@smart/contracts`.
- Produces: `HaAdapter` (`kind = 'ha'`, `serviceStatusTopic = 'status'`), `HaAdapterModule`; Export aus `index.ts`: `HaAdapter`, `HaAdapterModule`. Fähigkeits-`native`: `{ entity: string; source: 'onoff' | 'brightness' | 'kelvin' | 'numeric' | 'closed'; unit?: string }`.

**Beispieldateien (Protokoll v1, Spec 4.3).** Geräte-IDs sind 32 Hex-Zeichen. `devices.json` enthält genau diese Geräte:

```json
{
  "v": 1,
  "devices": [
    {
      "id": "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
      "name": "Stehlampe",
      "manufacturer": "Yeelight",
      "model": "color4",
      "area": "Wohnzimmer",
      "entities": [
        {
          "entity_id": "light.stehlampe",
          "domain": "light",
          "device_class": null,
          "name": null,
          "unit": null,
          "capabilities": {
            "supported_color_modes": ["color_temp", "hs"],
            "min_color_temp_kelvin": 1700,
            "max_color_temp_kelvin": 6500
          },
          "entity_category": null
        }
      ]
    },
    {
      "id": "1b2c3d4e5f60718293a4b5c6d7e8f90a",
      "name": "Monstera",
      "manufacturer": "Xiaomi",
      "model": "HHCCJCY01",
      "area": null,
      "entities": [
        {
          "entity_id": "sensor.monstera_battery",
          "domain": "sensor",
          "device_class": "battery",
          "name": "Battery",
          "unit": "%",
          "capabilities": { "state_class": "measurement" },
          "entity_category": "diagnostic"
        },
        {
          "entity_id": "sensor.monstera_moisture",
          "domain": "sensor",
          "device_class": "moisture",
          "name": "Moisture",
          "unit": "%",
          "capabilities": { "state_class": "measurement" },
          "entity_category": null
        },
        {
          "entity_id": "sensor.monstera_temperature",
          "domain": "sensor",
          "device_class": "temperature",
          "name": "Temperature",
          "unit": "°F",
          "capabilities": { "state_class": "measurement" },
          "entity_category": null
        },
        {
          "entity_id": "sensor.monstera_temperature_2",
          "domain": "sensor",
          "device_class": "temperature",
          "name": "Soil temperature",
          "unit": "°C",
          "capabilities": { "state_class": "measurement" },
          "entity_category": null
        },
        {
          "entity_id": "sensor.monstera_illuminance",
          "domain": "sensor",
          "device_class": "illuminance",
          "name": "Illuminance",
          "unit": "lx",
          "capabilities": { "state_class": "measurement" },
          "entity_category": null
        }
      ]
    },
    {
      "id": "2c3d4e5f60718293a4b5c6d7e8f90a1b",
      "name": null,
      "manufacturer": null,
      "model": "Door sensor",
      "area": null,
      "entities": [
        {
          "entity_id": "binary_sensor.flur_tuer",
          "domain": "binary_sensor",
          "device_class": "door",
          "name": "Flurtür",
          "unit": null,
          "capabilities": null,
          "entity_category": null
        },
        {
          "entity_id": "switch.flur_steckdose",
          "domain": "switch",
          "device_class": "outlet",
          "name": null,
          "unit": null,
          "capabilities": null,
          "entity_category": null
        }
      ]
    }
  ]
}
```

Schnappschüsse (`device-*.json`, Form `{"v":1,"entities":{…}}`):

- `device-lamp-on.json`: `light.stehlampe` `on`, Attribute `{"brightness":128,"color_temp_kelvin":2700,"color_mode":"color_temp","supported_color_modes":["color_temp","hs"],"friendly_name":"Stehlampe"}`, `last_updated` `2026-11-19T18:03:21.123456+00:00`.
- `device-lamp-off.json`: `off`, `{"brightness":null,"color_temp_kelvin":null,"color_mode":null,…}`, `2026-11-19T18:05:00.000000+00:00`.
- `device-lamp-unavailable.json`: `unavailable`, `{"friendly_name":"Stehlampe","supported_color_modes":["color_temp","hs"]}`.
- `device-plant.json`: battery `"87"`, moisture `"41.5"`, temperature `"68.0"` (°F), temperature_2 `"19.25"`, illuminance `"1200"`; `last_updated` verschieden, jüngstes `2026-11-19T17:00:00+00:00`.
- `device-door.json`: `binary_sensor.flur_tuer` `on` (offen), `switch.flur_steckdose` `off`.

**Erwartete Übersetzung (Tests, Spec 5):**

- Hardware Stehlampe: `externalId` = `address` = Geräte-ID, `name` `Stehlampe`, `vendor` `Yeelight`, `model` `color4`, `setupState` `ready`, `description` `null`, `native` = Geräteobjekt. Fähigkeiten in dieser Reihenfolge:
  - `state`: `kind` `binary`, `unit` `null`, `readable` `true`, `writable` `true`, `isSetting` `false`, `min`/`max`/`step`/`enumValues` `null`, `native` `{entity:'light.stehlampe', source:'onoff'}`
  - `brightness`: `numeric`, `%`, `min` 0, `max` 100, `step` 1, schreibbar, `native.source` `brightness`
  - `color_temp`: `numeric`, `K`, `min` 1700, `max` 6500, `step` `null`, schreibbar, `native.source` `kelvin`
- Monstera: `battery` (`%`, 0–100, nicht schreibbar, `numeric`, `unit` `%`), `soil_moisture`, `temperature` (aus `sensor.monstera_temperature`, `native.unit` `°F`), `temperature_2` (aus `…_temperature_2`). Illuminance ergibt nichts. Reihenfolge nach `entity_id`.
- Tür-Gerät: `name` = `Flurtür` (Name der ersten Entität nach Sortierung: `binary_sensor.flur_tuer`), `vendor` `''`; Fähigkeiten `contact` (`binary`, nicht schreibbar, `source` `closed`) und `state` (`switch`, schreibbar).
- Zusätzliche Unit-Fälle ohne Datei: Lampe nur mit `onoff` → nur `state`; Lampe mit `["brightness"]` → `state`, `brightness`; `min_color_temp_kelvin` 500 → `min` 1000 (Vokabular); Temperatur mit `unit` `"°X"` → keine Fähigkeit; Feuchte ohne `%` → keine; dritter Temperatursensor → `temperature_3`; Geräteliste mit `v: 2` oder ohne Liste → keine Ereignisse; Gerät ohne `id` wird übersprungen, andere bleiben.
- Decode `device-lamp-on`: `{state:true, brightness:50, color_temp:2700}`, `measuredAt` `2026-11-19T18:03:21.123Z`. `device-lamp-off`: `{state:false}`. `device-lamp-unavailable`: `{}`. Helligkeit 1 → 1 (nicht 0), 255 → 100, 0 → 0. Kelvin 12000 → 10000. `device-plant`: `battery 87`, `soil_moisture 41.5`, `temperature 20` (68 °F), `temperature_2 19.25`; `measuredAt` = jüngstes `last_updated`. `device-door`: `contact false`, `state false`. Zustand `"abc"` bei `numeric` → kein Wert; `last_updated` ohne Zone → zählt nicht.
- Verfügbarkeit: `device-lamp-unavailable` → `offline`; `device-lamp-on` → `online`; Schnappschuss mit `{}` → keine Verfügbarkeit.
- `classify`: `devices` → `{maxBytes: 4 MiB}`; `device/0a1b…` → `{maxBytes: 64 KiB}`; `device/` und `device/a/b` und `device/` + 65 Zeichen → `undefined`; `status`, `command`, `x` → `undefined`.
- `translate`: `devices` gültig → genau ein `hardware.listed`; `device/<id>` leer → `[]`; ungültiges JSON → `[{type:'activity'}]`; gültig → `[report, availability, activity]` in dieser Reihenfolge (Report-Ref `{address: id}`).
- `parseServiceStatus`: `online`, ` offline\n` → Wert; `{"state":"online"}`, `1`, > 1024 Bytes → `undefined`.

- [ ] **Step 1: Beispieldateien anlegen** (wie oben; mit `prettier` formatiert).
- [ ] **Step 2: Failing Specs** für `entities.ts` (`capabilitiesOf(device)`), `devices.ts` (`translateDevices(payload): AdapterEvent[]`), `decode.ts` (`decodeHaReport`, `availabilityOf(snapshot)`), `ha.adapter.ts` (`classify`, `translate`, `parseServiceStatus`, `decodeReport`) mit allen Fällen oben. `pnpm --filter @smart/backend exec vitest run src/adapters/ha` → rot.
- [ ] **Step 3: Umsetzen.** `protocol.ts`: zod-Schemas, nachsichtig wie `bridge.ts` des Z2M-Adapters (ein kaputtes Gerät oder eine kaputte Entität fällt einzeln heraus). Kollisionsregel: Schlüssel bereits vergeben → `<key>_2`, `<key>_3`, … Einheiten: Temperatur `°C` | `°F` | `K`; Prozentwerte nur `%`. `decode.ts` nach Spec 5.3, ISO-Zeit nur mit `Z` oder `±hh:mm`. Kommentare im Stil von `adapters/z2m`.
- [ ] **Step 4: Grün.** Gleicher Befehl, dann `pnpm --filter @smart/backend test:unit` (falls vorhanden, sonst `vitest run src`), `pnpm lint && pnpm typecheck`.
- [ ] **Step 5: Commit.** `feat(backend): add the home assistant adapter`.

---

### Task 3: Adapter verdrahten, Durchstich durch den echten Ingest

**Files:**

- Modify: `apps/backend/src/app.module.ts` (`AdaptersModule.forRoot([Z2mAdapterModule, HaAdapterModule], [Z2mAdapter, HaAdapter])`)
- Create: `apps/backend/test/ha-ingest.e2e-spec.ts`
- Modify: `apps/backend/src/adapters/README.md` (Liste der Adapter)

**Interfaces:**

- Consumes: `HaAdapter`, `HaAdapterModule` (Task 2), Registrierung mit `kind: 'ha'` (Task 1), Testhelfer der bestehenden E2E-Specs (`hardware-ingest.e2e-spec.ts`, `gateway-status.e2e-spec.ts` als Vorlage: Gateway registrieren, MQTT-Nachrichten veröffentlichen, auf Zustand warten).

- [ ] **Step 1: Failing E2E** (`ha-ingest.e2e-spec.ts`), Nutzlasten aus `integrations/home-assistant/fixtures/`:
  1. Gateway mit `kind: 'ha'` registrieren; `gw/<id>/bridge/connection` `1` und `gw/<id>/ha/status` `online` → Gateway `online`, `serviceStatus` `online`.
  2. `devices.json` (retained) → drei Hardware-Einträge unter „Neu erkannt“ mit den Fähigkeiten aus Task 2.
  3. Lampe als Gerät hinzufügen, `device-lamp-on.json` (nicht retained) → Messwerte `state=true`, `brightness=50`, `color_temp=2700` mit Zeit `18:03:21.123Z`; Verfügbarkeit `online`.
  4. `device-lamp-unavailable.json` → Verfügbarkeit `offline`, keine neuen Messwerte.
  5. `device-lamp-off.json` (nicht retained, 18:05) und danach eine retained Kopie von `device-lamp-on.json` (18:03) → der Stand bleibt `state=false` (Review Focus 3).
  6. Leere Nachricht auf `device/<id>` → nichts passiert; danach `devices.json` ohne die Tür → Tür-Hardware entfernt, Lampe bleibt.
  7. `gw/<id>/ha/status` `offline` → `serviceStatus` `offline`.
  8. Ein Z2M-Gateway daneben bekommt den HA-Status nicht (Status nur für Zeilen der passenden Art).
- [ ] **Step 2: Rot sehen.** `pnpm --filter @smart/backend test -- ha-ingest`.
- [ ] **Step 3: Verdrahten.**
- [ ] **Step 4: Grün**, dazu die ganze Backend-Suite (`pnpm --filter @smart/backend test`), `pnpm test:tz` für das Backend, `pnpm lint && pnpm typecheck`.
- [ ] **Step 5: Commit.** `feat(backend): accept home assistant gateways`.

---

### Task 4: Frontend – Art bei der Registrierung wählen

**Files:**

- Modify: `apps/frontend/src/app/features/gateways/register-form.ts` (+ Spec), `gateways.api.ts` falls `kind` dort noch nicht durchgereicht wird, `i18n/de.json` und `i18n/en.json` des Features (bzw. die vorhandenen Sprachdateien), `gateway-status.ts` (Kommentar `t(gateways.kind.ha)` für die Schlüsselextraktion)

**Interfaces:**

- Consumes: `GATEWAY_KINDS`, `gatewayRegisterSchema` aus `@smart/contracts`; `UiSegmentedButton` aus `@smart/ui/forms` (API in `apps/frontend/projects/ui/README.md` bzw. der Komponente nachlesen).

- [ ] **Step 1: Failing Specs:** Formular zeigt eine Auswahl „Art“ mit „Zigbee2MQTT“ (vorausgewählt) und „Home Assistant“; Absenden ohne Änderung sendet `kind: 'z2m'`, nach Wahl `kind: 'ha'`; Haushaltswechsel setzt die Auswahl zurück (wie Name und Zertifikat). Übersetzung `gateways.kind.ha` = „Home Assistant“ (de) / „Home Assistant“ (en), Label `gateways.register.kind` = „Art“ / „Kind“.
- [ ] **Step 2: Rot sehen.** `pnpm --filter @smart/frontend test -- register-form`.
- [ ] **Step 3: Umsetzen** mit `UiSegmentedButton`, Optionen aus `GATEWAY_KINDS` mit `kindKey(kind)`.
- [ ] **Step 4: Grün**, dann `pnpm lint` (inkl. `i18n:check`), `pnpm typecheck`, `pnpm --filter @smart/frontend test`, `pnpm build` (Bundle ≤ 425 kB, Wert im Bericht).
- [ ] **Step 5: Commit.** `feat(frontend): choose the kind when registering a gateway`.

---

### Task 5: Integration – Gerüst, reiner Protokollteil, Testlauf, CI

**Files:**

- Create: `integrations/home-assistant/custom_components/smart_bridge/manifest.json`, `protocol.py`, `__init__.py` (vorerst nur `DOMAIN`), `integrations/home-assistant/pyproject.toml` (nur ruff- und pytest-Konfiguration, kein Paketbau), `requirements-test.txt`, `tests/__init__.py`, `tests/test_protocol.py`, `test/run-tests.sh`, `README.md`
- Modify: `.github/workflows/ci.yml` (Suite `ha-integration` in der `ops-suite`-Matrix), `.github/dependabot.yml` (`pip` in `/integrations/home-assistant`), `.prettierignore` falls nötig
- Modify: `CLAUDE.md` (Zeile in der Befehlstabelle: „HA-Integration testen (Docker) | `bash integrations/home-assistant/test/run-tests.sh`“)

**Interfaces:**

- Produces (`protocol.py`, ohne HA-Import):

```python
PROTOCOL_VERSION = 1
DOMAINS = frozenset({"light", "switch", "sensor", "binary_sensor"})
MAX_SNAPSHOT_BYTES = 60 * 1024
MAX_DEVICES_BYTES = 4 * 1024 * 1024
MAX_TEXT_CHARS = 256

@dataclass(frozen=True)
class DeviceInfo:
    id: str
    name: str | None
    manufacturer: str | None
    model: str | None
    area: str | None
    disabled: bool

@dataclass(frozen=True)
class EntityInfo:
    entity_id: str
    device_id: str | None
    domain: str
    device_class: str | None
    name: str | None
    unit: str | None
    capabilities: Mapping[str, Any] | None
    entity_category: str | None  # "config" | "diagnostic" | None
    disabled: bool

@dataclass(frozen=True)
class StateInfo:
    state: str
    attributes: Mapping[str, Any]
    last_updated: str  # ISO 8601 with offset

def topic(gateway_id: str, sub: str) -> str: ...          # "gw/<id>/ha/<sub>"
def connection_topic(gateway_id: str) -> str: ...         # "gw/<id>/bridge/connection"
def device_topic(gateway_id: str, device_id: str) -> str: ...  # topic(id, f"device/{device_id}")
def select(devices: Iterable[DeviceInfo], entities: Iterable[EntityInfo]) -> dict[str, list[EntityInfo]]: ...
    # device_id -> entities sorted by entity_id; only enabled devices with ≥1 chosen entity (Spec 4.3)
def devices_payload(devices: Mapping[str, DeviceInfo], selection: Mapping[str, list[EntityInfo]]) -> bytes | None: ...
    # devices sorted by id; None if > MAX_DEVICES_BYTES
def snapshot_payload(entities: Sequence[EntityInfo], states: Mapping[str, StateInfo | None]) -> bytes | None: ...
    # entities without state left out; > MAX_SNAPSHOT_BYTES → attributes reduced to scalars; still too big → None
```

JSON kompakt (`separators=(",", ":")`, `ensure_ascii=False`), eigener `default`: `datetime`/`date` → `isoformat()`, `set`/`tuple`/`frozenset` → Liste, `Enum` → `.value`, sonst `str(x)`.

- [ ] **Step 1: Failing tests** (`tests/test_protocol.py`, reines pytest, ohne HA-Fixture): Auswahl (Domäne `cover` raus, deaktivierte Entität raus, `entity_category` `config` raus, `diagnostic` drin, Entität ohne Gerät raus, deaktiviertes Gerät raus, Gerät ohne gewählte Entität raus); Topics; Kürzung: Schnappschuss mit einem 70-KiB-Attribut → Attribut fehlt, skalare bleiben, Text > 256 Zeichen fällt weg; nicht kürzbar groß → `None`; JSON von `datetime`, `set`, `Enum`. **Vertrag:** Eingaben, die genau `fixtures/devices.json` und `fixtures/device-*.json` ergeben, im Test aufbauen und `json.loads(payload) == json.load(fixture)` prüfen (alle sechs Dateien).
- [ ] **Step 2: `test/run-tests.sh`** schreiben (Bash, `set -euo pipefail`, Stil wie `gateway/test/*.sh`): Phase 1 im Container `python:3.14.10-slim-trixie` mit dem Ordner eingebunden: `pip install --no-cache-dir -r requirements-test.txt`, `ruff format --check .`, `ruff check .`, `pytest -q`. (Phase 2, der Docker-Test, kommt in Task 7.) `requirements-test.txt`: `pytest-homeassistant-custom-component==0.13.375`, `ruff==<gepinnt>` (zieht pytest und HA 2026.10.4 mit). Laufen lassen → Tests rot.
- [ ] **Step 3: Umsetzen** von `protocol.py`; `manifest.json`: `{"domain":"smart_bridge","name":"Smart Home Bridge","version":"0.1.0","documentation":"https://github.com/tkosiol/smart-home/tree/main/integrations/home-assistant","codeowners":[],"requirements":["paho-mqtt==2.1.0"],"dependencies":[],"iot_class":"local_push","integration_type":"hub"}` (Schlüssel nach HA-Vorgaben prüfen). ruff: Zeilenlänge 100, Regeln `E,F,W,I,UP,B,SIM,ASYNC`.
- [ ] **Step 4: Grün:** `bash integrations/home-assistant/test/run-tests.sh`. CI-Suite eintragen: `- suite: ha-integration` / `run: bash integrations/home-assistant/test/run-tests.sh`. Dependabot: Eintrag `pip`, `directory: /integrations/home-assistant`, wöchentlich montags, `prefix: chore`, `include: scope`. README auf Deutsch wie `gateway/README.md`: Zweck, Aufbau, Verweis auf das Protokoll in der Spec, Testbefehl.
- [ ] **Step 5: Commit.** `feat(gateway): add the home assistant integration protocol` und `ci: test the home assistant integration`.

---

### Task 6: Integration – HA-Schicht und Verbindung

**Files:**

- Create: `custom_components/smart_bridge/collector.py`, `connection.py`, `bridge.py`; Modify: `__init__.py`
- Create: `tests/conftest.py` (`enable_custom_integrations`, Fake-Verbindung), `tests/test_bridge.py`, `tests/test_init.py`, `tests/test_connection.py`

**Interfaces:**

- Consumes: `protocol.py` (Task 5).
- Produces:

```python
# connection.py
class Connection(Protocol):
    def start(self) -> None: ...           # non-blocking: connects in the background, reconnects with 1–60 s backoff
    def stop(self, offline_payloads: Sequence[tuple[str, bytes]]) -> None: ...  # publish these (QoS 1, retained), wait ≤ 5 s, disconnect
    def publish(self, topic: str, payload: bytes) -> None: ...  # QoS 1, retained; dropped while disconnected
    @property
    def connected(self) -> bool: ...

class PahoConnection:  # implements Connection
    def __init__(self, *, gateway_id: str, host: str, port: int, ca_file: str, cert_file: str,
                 key_file: str, on_connected: Callable[[], None]) -> None: ...
    # client_id f"{gateway_id}-ha", MQTTv311, CallbackAPIVersion.VERSION2, tls_set(... TLSv1_2),
    # will_set(connection_topic, b"0", qos=1, retain=True), keepalive 30, connect_async + loop_start;
    # on_connect success: publish b"1" retained to connection_topic, then on_connected()
    # (the bridge hops into the event loop itself via hass.loop.call_soon_threadsafe)

# collector.py
def collect(hass: HomeAssistant) -> tuple[dict[str, DeviceInfo], list[EntityInfo]]: ...
def state_of(hass: HomeAssistant, entity_id: str) -> StateInfo | None: ...

# bridge.py
class Bridge:
    def __init__(self, hass: HomeAssistant, gateway_id: str,
                 connection_factory: Callable[[Callable[[], None]], Connection]) -> None: ...
    async def async_start(self) -> None: ...   # after HA started
    async def async_stop(self) -> None: ...    # on EVENT_HOMEASSISTANT_STOP
```

- `__init__.py`: `CONFIG_SCHEMA` mit `probatio` und `homeassistant.helpers.config_validation as cv` (Gateway-ID nach `^gw-[a-z0-9]{8}$`, Host Text, Port `cv.port`, drei Dateipfade `cv.isfile`), `async_setup` legt `Bridge` mit `PahoConnection` an und startet sie über `homeassistant.helpers.start.async_at_started`; `EVENT_HOMEASSISTANT_STOP` → `async_stop`. Der TLS-Kontext wird in `start()` im Executor geladen (`hass.async_add_executor_job`), nie in der Ereignisschleife.
- Ablauf nach Spec 4.4: bei `on_connected` vollständiger Stand (Liste, alle Schnappschüsse, dann `status` `online`); Registrierungsänderungen über `homeassistant.helpers.debounce.Debouncer` (Cooldown 2 s, nicht sofort); Zustandsänderungen über `async_track_state_change_event` für die gewählten Entitäten, bei jeder neuen Auswahl neu abonniert; je Gerät höchstens ein Schnappschuss pro Sekunde, sofort wenn der letzte länger als 1 s her ist, sonst einer am Ende des Fensters mit dem dann aktuellen Stand; entfernte Geräte → leere Nachricht auf ihr Topic. Stopp: Debouncer und Timer abbrechen, `connection.stop([(status, b"offline"), (connection_topic, b"0")])` im Executor.
- Logs: nur Ereignisse und Zählwerte (z. B. „published 3 devices“), nie Nutzlasten; Fehler der Verbindung als Warnung mit dem paho-Grund.

- [ ] **Step 1: Failing tests** mit `hass`-Fixture und Fake-Verbindung (zeichnet `publish` auf, `connected` steuerbar, ruft `on_connected` auf Wunsch): (a) Start mit einem Gerät „Stehlampe“ (`light`), einer Tür, einem Gerät nur mit `cover` → nach `on_connected`: `devices` mit zwei Geräten, zwei Schnappschüsse, zuletzt `status` `online`; (b) Zustand ändern → ein Schnappschuss; drei Änderungen innerhalb 0,5 s → einer sofort, einer nach Ablauf der Sekunde mit dem letzten Stand (Zeit per `async_fire_time_changed`); (c) Entität entfernen, deren Gerät dadurch herausfällt → nach 2 s neue Liste und leere Nachricht auf das Geräte-Topic; (d) Wiederverbindung (`on_connected` erneut) → vollständiger Stand erneut; (e) Stopp → `stop` mit `offline` und `0`; (f) Konfiguration: ungültige Gateway-ID → Setup schlägt fehl; gültige → Bridge angelegt (Paho-Verbindung per Patch ersetzt). `test_connection.py`: `PahoConnection` mit gepatchtem `paho.mqtt.client.Client` – Client-ID, Will, TLS-Aufruf, `on_connect` veröffentlicht `1` und ruft den Rückruf, `publish` während getrennt verwirft.
- [ ] **Step 2: Rot sehen:** `bash integrations/home-assistant/test/run-tests.sh`.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Grün** (dieselbe Suite, ruff sauber).
- [ ] **Step 5: Commit.** `feat(gateway): forward home assistant devices and states`.

---

### Task 7: Integration im echten HA-Image (Docker-Test)

**Files:**

- Modify: `integrations/home-assistant/test/run-tests.sh` (Phase 2), Create: `integrations/home-assistant/test/ha-config/configuration.yaml` (Testkonfiguration)

**Interfaces:**

- Consumes: Broker-Image aus `infra/broker` und Wegwerf-PKI aus `infra/pki/pki.sh` genau wie `gateway/test/gateway-test.sh` (dort abschauen: CA, Server-Zertifikat, Gateway-Zertifikat, Passwort des API-Benutzers, Netz, Aufräumen per `trap`).

- [ ] **Step 1: Test schreiben** (Phase 2 von `run-tests.sh`): Wegwerf-PKI, Broker starten, HA `ghcr.io/home-assistant/home-assistant:2026.11.0` mit `custom_components/smart_bridge` (read-only), Secrets (read-only) und der Testkonfiguration: `http`, `smart_bridge` (Broker im Docker-Netz), dazu `demo:` für eine Demo-Lampe mit Gerät. Ein Abonnent als `smart-api` auf `gw/<id>/#` prüft innerhalb von 180 s: `gw/<id>/bridge/connection` = `1`; `gw/<id>/ha/status` = `online`; `gw/<id>/ha/devices` ist JSON mit `v` = 1 und mindestens einem Gerät mit einer `light`-Entität; ein `gw/<id>/ha/device/<id>` mit `v` = 1. Dann `docker stop` (Timeout 30 s) → `status` = `offline` und `bridge/connection` = `0`. Zusätzlich: das HA-Log enthält keine `ERROR`-Zeile mit `smart_bridge`, und keine Nutzlast (z. B. `"entities"`) steht im Log. Lässt sich `demo` in HA 2026.11.0 nicht per YAML laden, prüft der Test nur eine gültige Liste (sie darf dann leer sein) und keinen Schnappschuss; das steht dann im Bericht und im README (Lampen ohne Gerät, etwa über `template`, meldet die Integration nicht).
- [ ] **Step 2: Laufen lassen** (`bash integrations/home-assistant/test/run-tests.sh`), Fehler beheben, bis grün.
- [ ] **Step 3: Commit.** `test(gateway): run the integration in the pinned home assistant image`.

---

### Task 8: Gateway-Paket – Dienst, Konfiguration, Deploy, Backup

**Files:**

- Modify: `gateway/compose.yaml` (Dienst `homeassistant`, Profil `ha`; Backup-Dienst bindet `./homeassistant-data:/data/homeassistant-data:ro` ein)
- Create: `gateway/homeassistant/configuration.yaml`
- Modify: `gateway/deploy.sh` (Kopie der Integration, Ausschluss `homeassistant-data/`, Profil-Schalter, Warten auf HA), `gateway/start.sh` (Profil-Schalter), `gateway/backup/restic-job.sh` (Einschluss/Ausschluss, Restore-Test), `gateway/README.md`
- Modify: Tests `gateway/test/gateway-test.sh`, `gateway/test/deploy-tests.sh`, `gateway/test/backup-tests.sh`
- Modify: `.github/dependabot.yml` (`docker-compose` für `/gateway`, falls nicht vorhanden)

**Interfaces:**

- Consumes: Integration unter `integrations/home-assistant/custom_components/smart_bridge/` (Task 5/6); `secrets/ha/ha.env` mit `SMART_HA_GATEWAY_ID` und `secrets/ha/{ca.crt,gateway.crt,gateway.key}` (Task 9 schreibt sie).

Dienst (Spec 7):

```yaml
homeassistant:
  image: ghcr.io/home-assistant/home-assistant:2026.11.0
  profiles: [ha]
  restart: unless-stopped
  # Host network: Yeelight and other discovery need multicast. The UI (8123) is reachable in the home network,
  # protected by HA's own login. Never forward it to the internet.
  network_mode: host
  # Only effective with the memory cgroup enabled (docs/runbooks/gateway.md); measured ~300 MB on a Pi 3B+.
  mem_limit: 512m
  env_file:
    - ./secrets/ha/ha.env
  environment:
    BROKER_HOST: ${BROKER_HOST:?set BROKER_HOST in secrets/gateway.env}
    BROKER_PORT: ${BROKER_PORT:?set BROKER_PORT in secrets/gateway.env}
    TZ: ${TZ:-Europe/Berlin}
  volumes:
    - ./homeassistant-data:/config
    - ./homeassistant/configuration.yaml:/config/configuration.yaml:ro
    - ./homeassistant/custom_components/smart_bridge:/config/custom_components/smart_bridge:ro
    - ./secrets/ha:/smart/secrets:ro
  logging: *logging
```

`gateway/homeassistant/configuration.yaml`:

```yaml
# Home Assistant on the gateway (docs/superpowers/specs/2026-11-19-home-assistant-adapter-design.md, section 7).
# Deliberately without default_config: only what the UI, discovery and the bridge need (the Pi has 1 GB).
http:
frontend:
config:
person:
network:
ssdp:
zeroconf:
dhcp:
logger:
  default: warning
recorder:
  # The platform keeps the history; one day here spares the SD card.
  purge_keep_days: 1
  commit_interval: 60
smart_bridge:
  gateway_id: !env_var SMART_HA_GATEWAY_ID
  broker_host: !env_var BROKER_HOST
  broker_port: !env_var BROKER_PORT
  ca_file: /smart/secrets/ca.crt
  cert_file: /smart/secrets/gateway.crt
  key_file: /smart/secrets/gateway.key
```

- Profil-Schalter (deploy.sh und start.sh gleich): existiert `secrets/ha/ha.env` auf dem Pi, laufen alle `docker compose`-Aufrufe mit `--profile ha`; sonst ohne. Die Prüfung läuft auf dem Pi (root), nie mit Inhalt der Datei.
- Deploy: nach dem rsync von `gateway/` ein zweiter rsync `integrations/home-assistant/custom_components/smart_bridge/` → `$dir/homeassistant/custom_components/smart_bridge/` mit `--delete` und denselben Optionen; `--exclude=/homeassistant-data/` beim ersten rsync. `homeassistant-data/` anlegen (root, 700), falls nicht vorhanden. Nach `start.sh`: mit HA-Profil bis zu 600 s alle 10 s `curl -fsS -o /dev/null http://127.0.0.1:8123/manifest.json` auf dem Pi; Erfolg → „Home Assistant is up“; Zeitüberschreitung → Warnung „Home Assistant did not answer in 600 s – Zigbee2MQTT is running; check docker compose logs homeassistant“, Exit 0 (Spec 7: HA-Fehler rollt nichts zurück).
- Backup: `restic backup … "$data" /data/secrets` wird zu `… "$data" /data/secrets` plus `/data/homeassistant-data`, wenn vorhanden, mit `--exclude "/data/homeassistant-data/home-assistant_v2.db*" --exclude "/data/homeassistant-data/*.log*"`. Restore-Test: zusätzlich, wenn im Snapshot `homeassistant-data/.storage/core.config_entries` existiert, muss es nicht leer und gültiges JSON sein (`python3` fehlt im restic-Image: Prüfung auf erstes Zeichen `{` genügt).

- [ ] **Step 1: Failing tests.** `deploy-tests.sh`: mit vorhandener `secrets/ha/ha.env` im Stub-Pi → zweiter rsync mit `--delete` und Zielpfad, `compose` mit `--profile ha`, HA-Warte-Schleife ruft `curl` auf 8123; ohne die Datei → keine `--profile ha`, kein `curl` auf 8123, Ablauf wie bisher (bestehende Erwartungen unverändert grün); HA antwortet nie → Exit 0 mit Warnung. `backup-tests.sh`: HA-Daten im Snapshot, `home-assistant_v2.db` und `home-assistant.log` nicht; ohne `homeassistant-data` läuft das Backup wie bisher; Restore-Test scheitert bei leerer `core.config_entries`. `gateway-test.sh`: `docker compose --env-file … config --services` ohne Profil enthält `homeassistant` nicht, mit `--profile ha` schon; `configuration.yaml` ist gültiges YAML (mit `python3 -c` im HA-Image laden **oder** `docker run … hass --script check_config -c /config` mit eingebundener Konfiguration und Dummy-Secrets: bevorzugt, falls in angemessener Zeit lauffähig).
- [ ] **Step 2: Rot sehen** (`bash gateway/test/deploy-tests.sh`, `bash gateway/test/backup-tests.sh`, `bash gateway/test/gateway-test.sh`).
- [ ] **Step 3: Umsetzen** (Kommentare im Stil der Dateien; `gateway/README.md`: Tabelle um `homeassistant/`, Secrets-Tabelle um `secrets/ha/`, Abschnitt „Home Assistant“ mit Profil, Netz, Speicher, Daten).
- [ ] **Step 4: Grün**, dazu `shellcheck` wie in CI (Suite `shellcheck` in `.github/workflows/ci.yml` nachsehen und lokal gleich aufrufen).
- [ ] **Step 5: Commit.** `feat(gateway): run home assistant on the gateway`.

---

### Task 9: `provision-ha.sh`

**Files:**

- Create: `infra/deploy/provision-ha.sh`
- Modify: `infra/deploy/test/run-tests.sh` (Abschnitt `provision-ha.sh`, Stubs wie bei `provision-gateway.sh`)

**Interfaces:**

- Produces auf dem Pi: `/srv/smart-gateway/secrets/ha/` (root, 700) mit `ha.env` (`SMART_HA_GATEWAY_ID=<id>`), `ca.crt`, `gateway.crt`, `gateway.key` (alle 600).

Verhalten (Muster und Sicherheitseigenschaften exakt wie `provision-gateway.sh`, dort abschauen): `SMART_PI=<user@pi-host> infra/deploy/provision-ha.sh <ha-gateway-id> [--force]`; ID nach `^gw-[a-z0-9]{8}$` (sonst Exit 2, nichts kontaktiert); Zertifikat und Schlüssel aus `$SMART_PKI_DIR/gateways/<id>.{crt,key}` und `ca.crt` müssen existieren, Zertifikat-CN = ID und Schlüssel passt zum Zertifikat (OpenSSL ≥ 3 wie im Original); eine SSH-Sitzung, tar über stdin, `sudo -n`; auf dem Pi: `secrets/gateway.env` muss existieren (sonst Abbruch „provision the Z2M gateway first“), seine `GATEWAY_ID` (zeilenweise gelesen, nie per `source`) darf nicht gleich der HA-ID sein (Review Focus 5); vorhandenes `secrets/ha/` ohne `--force` → Abbruch, mit `--force` ersetzt; atomar (erst in `secrets/ha.partial`, dann `mv`), bei Fehler bleibt das alte. Keine Ausgabe von Schlüsselinhalten.

- [ ] **Step 1: Failing tests** in `infra/deploy/test/run-tests.sh`: ungültige IDs → Exit 2 ohne Aufrufe; fehlende PKI-Dateien → Abbruch ohne Kontakt; CN passt nicht → Abbruch; gleiche ID wie `gateway.env` → Abbruch, nichts geschrieben; fehlende `gateway.env` → Abbruch; Erfolg → Dateien mit Modi 700/600 und Inhalt; zweiter Lauf ohne `--force` → Abbruch, mit `--force` → ersetzt; kein Schlüsselinhalt in der Ausgabe.
- [ ] **Step 2: Rot sehen:** `bash infra/deploy/test/run-tests.sh`.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Grün** + `shellcheck infra/deploy/provision-ha.sh`.
- [ ] **Step 5: Commit.** `feat(infra): provision the home assistant gateway on the pi`.

---

### Task 10: Dokumentation

**Files:**

- Create: `docs/adr/0022-home-assistant-integration.md`; Modify: `docs/adr/README.md` (Zeile)
- Modify: `docs/runbooks/gateway.md` (neuer Abschnitt „13. Home Assistant auf dem Pi“, Verweis im Überblick; Fehlerbilder: HA startet nicht, Speicher, Yeelight nicht gefunden)
- Modify: `docs/superpowers/specs/2026-10-11-smart-home-architecture-design.md` (Nachtrag: Gateway-Arten `z2m`, `ha`; HA verbindet sich direkt)
- Modify: `docs/architecture/overview.md` (HA-Gateway im Bild/Text), `docs/adr/0021-gateway-adapters-in-backend.md` (Konsequenzen: neue Art braucht auch eine Migration der Prüfregel – als Nachtrag mit Datum)
- Modify: `integrations/home-assistant/README.md` (vollständig), `apps/backend/src/adapters/README.md`

ADR-0022 (Deutsch, Form wie ADR-0021): Kontext (HA als zweite Art, fremde Installationen später, Pi 1 GB), Entscheidung (eigene schlanke Integration, Direktverbindung per mTLS, ein HA = ein Gateway, Schnappschuss je Gerät, Python nur in `integrations/home-assistant/`), Konsequenzen (zweite Sprache mit eigener Suite; Update der Integration nur bei neuen Domänen oder Protokolländerung; HACS und Kopplungscode später; `mem_limit` wirkt auf dem Pi erst mit Speicher-Cgroup).

Runbook-Abschnitt (Schritte in dieser Reihenfolge, Platzhalter statt echter Hosts): 1. `infra/pki/pki.sh issue-gateway` → neue ID; 2. in der App Gateway registrieren, Art „Home Assistant“, Zertifikat einfügen; 3. `SMART_PI=<user@pi-host> infra/deploy/provision-ha.sh <ha-id>`; 4. `SMART_PI=<user@pi-host> pnpm gateway:deploy` (erster Start bis 10 min); 5. `http://<pi-host>:8123` → HA-Konto anlegen, Einheiten metrisch; 6. Yeelight-App: je Lampe „LAN-Steuerung“ an; HA → Einstellungen → Geräte & Dienste → „Yeelight“ hinzufügen (wird meist automatisch gefunden); 7. App → Gateways: HA online; Geräte → „Neu erkannt“: Lampen hinzufügen. Optional: Speicher-Cgroup (`cgroup_enable=memory` an die eine Zeile in `/boot/firmware/cmdline.txt` anhängen, Neustart; prüfen mit `docker info` ohne Warnung „No memory limit support“). Rückweg: `secrets/ha` umbenennen und deployen → HA startet nicht mehr, Z2M unberührt; Gateway in der App sperren.

- [ ] **Step 1: Schreiben.**
- [ ] **Step 2: Prüfen:** `pnpm lint` (prettier für Markdown), `git grep -nE -f .local/private-patterns.txt -- .` leer.
- [ ] **Step 3: Commit.** `docs: home assistant gateway`.
