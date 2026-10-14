# Etappe 6a: Sensoren sehen – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Erkannte Zigbee-Hardware eines registrierten Gateways erscheint in der App; ein owner macht daraus ein Gerät (Name aus Z2M vorbelegt); Messwerte werden gespeichert und alle Mitglieder sehen die aktuellen Werte auf Übersicht und Geräteseite.

**Architecture:** Neue Core-Module `core/devices` (Hardware, Fähigkeiten, Geräte, Bindungen, Zustand, Ingest der Z2M-Nachrichten) und `core/telemetry` (Hypertable `measurements`, gepufferter Schreiber). Der Ingest abonniert die Präfixe registrierter Gateways und ordnet Nachrichten über `bridge/devices` (`friendly_name` ↔ IEEE) zu. Frontend: Feature `devices` (Liste, „Neu erkannt“, Detail) und lazy geladene Übersichtskarten.

**Tech Stack:** wie 5a; TimescaleDB (vorhanden, Extension in Migration 0000), keine neuen Abhängigkeiten.

**Spec:** `docs/superpowers/specs/2026-10-14-etappe-6a-sensoren-sehen-design.md` (freigegeben) und Architektur-Spec 8.4, 8.5, 9. Baut auf `feat/etappe-5a-broker-gateways` auf.

**Planform:** schlank wie 5a – vollständiger Code nur an kniffligen Stellen (Exposes-Auswertung, Zeitstempel-Plausibilisierung, Hypertable-Migration, Puffer-Schreiber, lazy Übersichtskarten); sonst Verhalten, Schnittstellen und Tests.

**Bewusste Entscheidungen:**

- **Lazy Übersichtskarten:** `FeatureDefinition.overviewCards` nimmt zusätzlich Lader `() => Promise<Type<unknown>>` an; die Übersicht lädt sie nach. Sonst landete die Karten-Komponente im initialen Bundle.
- **Ingest-Abos je Gateway:** Der Konsument abonniert `<topic_prefix>/#` für jedes registrierte, nicht gesperrte Gateway und reagiert auf Registrierung und Sperrung über das interne Ereignis von `core/gateways` (Erweiterung um `gateway.registered`/`gateway.revoked`).
- **Stundenaggregat erst in 6b**; 6a speichert nur Rohwerte.

## Global Constraints

- Alle Global Constraints aus Plan 5a gelten weiter (Prüfung je Task: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; bei Compose/E2E zusätzlich `sh infra/compose/test/stack-test.sh`; keine KI-Attribution; öffentliches Repo; Startcode nur `@smart/ui/shell`; initiales Bundle < 480 kB).
- Zeit: speichern nur `timestamptz` in UTC; `last_seen` nach UTC umrechnen; mehr als 2 min in der Zukunft oder älter als 7 Tage → Empfangszeit und Flag `time_replaced` (Architektur-Spec 9.4).
- `measurements`: Hypertable, Chunk 7 Tage, Kompression nach 7 Tagen (`segmentby device_id, capability`), Retention 1 Jahr; eindeutig (`device_id`, `capability`, `time`), Schreiben mit `ON CONFLICT DO NOTHING`.
- Messwerte nur für lesbare Nicht-Einstellungen; `binary` → 0/1 in `value_num`, `enum` → `value_text`, `numeric` → `value_num`; `text`/`composite` nur in `device_state`.
- Rollen: Hardware zuordnen = owner; Gerät umbenennen = member; ansehen = viewer. Haushaltspfade mit `HouseholdGuard`, fremd/unbekannt → `404`.
- Ingest ignoriert `…/set`, `…/get`, `bridge/request/#`; eine fehlerhafte Nachricht beendet den Konsumenten nie; Inhalte von Nachrichten nie vollständig loggen.

## Review Focus

1. **Umbenennen in Z2M und Namensgleichheit:** Nachricht unter dem alten Namen nach einer Umbenennung, zwei Geräte gleichen Namens an verschiedenen Gateways → richtige Hardware oder sauber verworfen. → Tests in Task 3.
2. **Nachlieferung nach Ausfall:** Hunderte gepufferte Nachrichten mit alten `last_seen` in schneller Folge, teils doppelt → richtige Messzeit, keine Duplikate, Zustand = neuester Wert, nicht der zuletzt angekommene. → Tests in Task 4.
3. **Falsche Pi-Uhr:** `last_seen` in der Zukunft, aus 1970 oder ohne Offset → Empfangszeit mit Flag. → Tests in Task 4.
4. **Fremde Hardware zuordnen:** `hardwareId` eines Gateways aus einem anderen Haushalt oder schon gebundene Hardware → `404` bzw. `409`, nichts angelegt. → Tests in Task 5.
5. **Gerät ohne Werte:** frisch zugeordnet, Batterie leer, offline, Wert fehlt in der Nachricht → Oberfläche zeigt „noch keine Werte“/„offline“, nie leer, `NaN` oder `undefined`. → Tests in Task 6.

---

### Task 1: Contracts – Hardware, Geräte, Fähigkeiten

**Files:** `packages/contracts/src/devices.ts` (+ `.spec.ts`), `packages/contracts/src/api-error.ts`, `packages/contracts/src/index.ts`, Frontend-Fehlertexte (Wurzelübersetzung, wie 5a Task 1).

**Interfaces (Produces):**

```ts
export const CAPABILITY_KINDS = ['numeric', 'binary', 'enum', 'text', 'composite'] as const;
export const capabilitySchema = z.object({ key, kind, unit: nullable string, min, max, step: nullable number, enumValues: nullable string[], readable, writable, isSetting: boolean });
export const hardwareSchema = z.object({ id, gatewayId, ieeeAddress, friendlyName, vendor, model, description: nullable, availability: 'online'|'offline'|'unknown', lastSeenAt: nullable ISO, lastState: z.record(z.string(), z.unknown()), capabilities: capabilitySchema[] });
export const deviceSchema = z.object({ id, name, icon: nullable, hardware: { id, vendor, model, description }, availability, lastSeenAt: nullable ISO, state: z.record(z.string(), z.unknown()), capabilities: capabilitySchema[] /* readable, no settings */ });
export const deviceCreateSchema = z.object({ hardwareId: z.string(), name: displayNameSchema });
export const deviceRenameSchema = z.object({ name: displayNameSchema });
/** Key of the value shown first: soil_moisture, temperature, humidity, state, else the first numeric one. */
export function primaryCapability(capabilities: readonly Capability[]): Capability | undefined;
export const LOW_BATTERY_PERCENT = 20;
```

Neuer Fehlercode `device.hardwareBound` (+ Texte de/en).

**Tests:** Schemas mit realistischen Werten (aus den Simulator-Fixtures abgeleitet); `primaryCapability` für Bodensensor (`soil_moisture`), Lampe (`state`), nur Temperatur, nur unbekannte numerische, keine. Commit `feat(contracts): describe hardware and devices`.

---

### Task 2: Datenmodell – Hardware, Geräte, Messwerte

**Files:** `apps/backend/src/core/devices/{index.ts,devices.module.ts,devices.schema.ts,hardware.repository.ts,devices.repository.ts,*.spec.ts}`, `apps/backend/src/core/telemetry/{index.ts,telemetry.module.ts,telemetry.schema.ts,measurements.repository.ts,*.spec.ts}`, Migration(en) (drizzle-kit + Hypertable-SQL), `apps/backend/src/app.module.ts`, `apps/backend/test/database.e2e-spec.ts` (Migrationszahl), `apps/backend/test/devices-schema.e2e-spec.ts`.

**Schema:** Tabellen wie Spec 2. Fremdschlüssel: `hardware.gateway_id` → gateways `on delete cascade`; `devices.household_id` → households `on delete cascade`; Bindungen → devices/hardware `on delete cascade`; `device_state.device_id` → devices `on delete cascade`; `measurements.device_id` ohne FK (Hypertable, Löschung über Retention). Partielle Unique-Indizes `device_bindings(device_id) WHERE unbound_at IS NULL` und `(hardware_id) WHERE unbound_at IS NULL`.

**Hypertable (handgeschriebener Teil der Migration):**

```sql
SELECT create_hypertable('measurements', by_range('time', INTERVAL '7 days'));
ALTER TABLE measurements SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'device_id, capability',
  timescaledb.compress_orderby = 'time DESC'
);
SELECT add_compression_policy('measurements', INTERVAL '7 days');
SELECT add_retention_policy('measurements', INTERVAL '1 year');
```

**Repositories (Produces):** `HardwareRepository.upsertFromBridge(gatewayId, devices: Z2mDevice[], now)` → `{ upserted: number; removed: number }`; `findByName(gatewayId, friendlyName)`; `listUnassigned(householdId)`; `DevicesRepository.createWithBinding(householdId, hardwareId, name)`; `list(householdId)`, `get(householdId, deviceId)`, `rename(…)`, `activeBindingForHardware(hardwareId)`; `MeasurementsRepository.insertMany(rows)` mit `ON CONFLICT DO NOTHING`.

**Tests (gegen DB):** Migration legt Hypertable und Policies an (`timescaledb_information.hypertables`, `jobs`); Unique-Bindung je Gerät/Hardware; doppelte Messung wird ignoriert; Löschen eines Haushalts entfernt Geräte. Commit `feat(backend): store hardware, devices and measurements`.

---

### Task 3: Ingest – Gateways abonnieren, Hardware erkennen

**Files:** `apps/backend/src/core/gateways/{gateway-events.ts,gateways.service.ts,index.ts}` (Ereignisse `gateway.registered`, `gateway.revoked`; Liste aktiver Gateways mit Präfix), `apps/backend/src/core/devices/{exposes.ts,device-ingest.consumer.ts,name-map.ts,*.spec.ts}`, `apps/backend/test/device-ingest.e2e-spec.ts`.

**Exposes auswerten:**

```ts
// Z2M access bits: 1 = published state, 2 = settable, 4 = gettable.
const PUBLISHED = 1;
const SETTABLE = 2;

/** Flattens Z2M exposes (incl. features of light/switch/composite) into capabilities. */
export function capabilitiesFromExposes(exposes: readonly Expose[]): Capability[] {
  const out: Capability[] = [];
  const visit = (e: Expose) => {
    if (e.features && e.type !== 'composite') return e.features.forEach(visit);
    if (!e.property) return;
    const readable = ((e.access ?? 0) & PUBLISHED) !== 0;
    const writable = ((e.access ?? 0) & SETTABLE) !== 0;
    out.push({
      key: e.property,
      kind: kindOf(e.type),
      unit: e.unit ?? null,
      min: e.value_min ?? null,
      max: e.value_max ?? null,
      step: e.value_step ?? null,
      enumValues: e.values ?? null,
      readable,
      writable,
      // Settable and published: a setting of the device (calibration, sampling, thresholds), not a reading.
      isSetting:
        readable &&
        writable &&
        e.type !== 'binary' &&
        !['state', 'brightness', 'color_temp'].includes(e.property),
    });
  };
  exposes.forEach(visit);
  return dedupeByKey(out);
}
```

(`kindOf`: `numeric`→numeric, `binary`→binary, `enum`→enum, `text`→text, sonst composite; Lampen-`state`/`brightness`/`color_temp` sind Messwerte, keine Einstellungen.)

**Verhalten:** Beim Start und bei `gateway.registered` abonniert der Konsument `<prefix>/#` des Gateways, bei `gateway.revoked` hebt er das Abo auf. `bridge/devices` → `upsertFromBridge` (Koordinator `type: 'Coordinator'` ignoriert; nicht mehr gelistete Hardware `removed_at`; wieder erscheinende Hardware `removed_at = null`) und Namenszuordnung je Gateway neu aufbauen (`friendly_name` → Hardware-ID, im Speicher und aus der DB beim Start). `bridge/event` (`device_joined`, `device_interview`, `device_leave`, `device_renamed`) aktualisiert Hardware bzw. Zuordnung; `<name>/availability` (`{"state":"online"|"offline"}` oder Text) aktualisiert Hardware und gebundenes Gerät. Gerätenachrichten übergibt der Konsument an Task 4 (Schnittstelle `DeviceMessageHandler.handle(gatewayId, hardwareId, payload, receivedAt)`; in dieser Task ein Platzhalter, der nur `last_state`/`last_seen_at` schreibt).

**Tests (echter Broker):** Simulator-Fixture als retained `bridge/devices` → 7 Hardware mit Fähigkeiten, Kalibrierung/Sampling/Warnschwelle als `isSetting`, `soil_moisture`/`battery`/`dry` als Messwerte, Lampe `state` als Messwert; Umbenennung per `bridge/event` → Nachricht unter neuem Namen landet richtig, unter altem Namen verworfen (gezählt, einmal pro Stunde geloggt); zwei Gateways mit gleichem `friendly_name` → jeweils eigene Hardware; Gateway gesperrt → keine Verarbeitung mehr; neu registriert → ohne Neustart verarbeitet; `…/set` ignoriert. Commit `feat(backend): discover hardware from zigbee2mqtt`.

---

### Task 4: Ingest – Messwerte und Zustand

**Files:** `apps/backend/src/core/devices/{device-message.handler.ts,measurement-time.ts,*.spec.ts}`, `apps/backend/src/core/telemetry/{measurement-writer.ts,*.spec.ts}`, `apps/backend/test/device-telemetry.e2e-spec.ts`.

**Messzeit:**

```ts
const FUTURE_TOLERANCE_MS = 2 * 60_000;
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** The time a reading was taken: Z2M's last_seen when plausible, else the receive time (flagged). */
export function measurementTime(
  lastSeen: unknown,
  receivedAt: Date,
): { time: Date; replaced: boolean } {
  // Only ISO 8601 with an explicit offset or Z; anything else (no offset, epoch numbers) is not trusted.
  if (typeof lastSeen === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(lastSeen)) {
    const time = new Date(lastSeen);
    const ms = time.getTime();
    const now = receivedAt.getTime();
    if (!Number.isNaN(ms) && ms <= now + FUTURE_TOLERANCE_MS && ms >= now - MAX_AGE_MS) {
      return { time, replaced: false };
    }
  }
  return { time: receivedAt, replaced: true };
}
```

**Verhalten:** Felder der Nachricht gegen die Fähigkeiten der Hardware prüfen (Typ und, bei numeric, endliche Zahl; enum ∈ Werte; binary `true`/`false`); ungültige Felder verwerfen und zählen. `hardware.last_state` (zusammengeführt) und `last_seen_at`. Bei aktiver Bindung: `device_state` nur fortschreiben, wenn die Messzeit nicht älter ist als der gespeicherte Stand (Nachlieferung überschreibt keinen neueren Zustand); Messwerte für lesbare Nicht-Einstellungen an den `MeasurementWriter` (Puffer: alle 1 s oder bei 500 Zeilen schreiben, `ON CONFLICT DO NOTHING`, Fehler loggen ohne Inhalt, bei Herunterfahren leeren).

**Tests:** `measurementTime` für gültig, Zukunft > 2 min, 8 Tage alt, `1970-01-01T00:00:00Z`, ohne Offset, Zahl, fehlend; Nachricht ohne Bindung → nur `last_state`; mit Bindung → Zustand und Messwerte (binary 0/1, enum text); ungültiges Feld verworfen, Rest gespeichert; 300 nachgelieferte Nachrichten mit aufsteigendem altem `last_seen`, gemischt mit einer neueren → Zustand = neueste, 300 Messzeilen ohne Duplikate bei doppelter Lieferung; Writer-Puffer schreibt nach 1 s und bei 500; Herunterfahren leert. Commit `feat(backend): record readings from zigbee2mqtt`.

---

### Task 5: API – Hardware zuordnen, Geräte lesen und umbenennen

**Files:** `apps/backend/src/core/devices/{devices.controller.ts,devices.service.ts,*.spec.ts}`, `apps/backend/test/{devices-api.e2e-spec.ts,household-tenancy.e2e-spec.ts}`.

**Endpunkte** wie Spec 4. `GET …/hardware?state=unassigned` nur Hardware der nicht gesperrten Gateways des Haushalts ohne aktive Bindung und ohne `removed_at`. `POST …/devices` in einer Transaktion: Hardware gehört zu einem Gateway des Haushalts (sonst `404 household.notFound`), keine aktive Bindung (sonst `409 device.hardwareBound`; gleichzeitige Anfragen → genau eine gewinnt über den partiellen Unique-Index), Gerät + Bindung + `device_state` aus `hardware.last_state` vorbelegen. Liste/Detail liefern nur lesbare Nicht-Einstellungen als Fähigkeiten.

**Tests:** owner ordnet zu → Gerät erscheint mit Zustand aus `last_state`; member → `403`; Hardware eines anderen Haushalts → `404`, nichts angelegt; doppelt → `409`; zwei gleichzeitig → `201` + `409`; Umbenennen als member ok, als viewer `403`; Tabellentest um alle neuen Pfade erweitert. Commit `feat(backend): turn hardware into devices`.

---

### Task 6: Frontend – Geräte, Detail, Übersichtskarten

**Files:** `apps/frontend/src/app/core/features/feature-registry.ts` (+ Spec; lazy Karten), `apps/frontend/src/app/features/dashboard/dashboard-page.ts` (+ Spec), `apps/frontend/src/app/features/devices/{devices.routes.ts,devices-page.ts,device-page.ts,new-hardware.ts,device-card.ts,device-values.ts,devices-feature.ts,i18n/{de,en}.json,*.spec.ts}`, `apps/frontend/src/app/app.config.ts`, `apps/frontend/src/app/app.routes.ts` (`geraete/:id`).

**Lazy Karten:**

```ts
export type OverviewCard = Type<unknown> | (() => Promise<Type<unknown>>);
// Dashboard: resolves loaders once (Promise.all), then renders with NgComponentOutlet; a failing loader drops only its card.
```

**Seiten:** wie Spec 5. Werte über eine kleine reine Funktion `formatReading(capability, value, locale)` (Zahl mit `Intl.NumberFormat`, Einheit, binary → „ja“/„nein“ bzw. „trocken“, fehlender Wert → „–“ mit Text „noch keine Werte“ für Screenreader). Bekannte Schlüssel übersetzt (`soil_moisture`, `temperature`, `humidity`, `battery`, `dry`, `linkquality`, `state`, `brightness`, `color_temp`), unbekannte zeigen den Schlüssel. Aktualisierung: Laden beim Öffnen, alle 60 s solange `document.visibilityState === 'visible'`, beim Zurückkehren. Muster wie `features/gateways` (LoadedList, Haushaltsfehler, `current()?.id`). Übersicht: eine Karte je Gerät mit Hauptwert (`primaryCapability`) und Batterie; unter `LOW_BATTERY_PERCENT` Hinweis. Initiales Bundle messen (Karte lazy).

**Tests:** owner sieht „Neu erkannt“ mit vorbelegtem Namen und fügt hinzu (Body geprüft); member sieht den Abschnitt nicht; Liste zeigt Hauptwert, Batterie, „zuletzt gemeldet“; Gerät ohne Werte → „noch keine Werte“; offline → Hinweis; Batterie 15 % → Hinweis; Detail zeigt alle Messwerte mit Einheit, keine Einstellungen; Umbenennen als member; Aktualisierung nach 60 s (Fake-Uhr) und nicht bei verstecktem Tab; Übersicht lädt Karte lazy und zeigt je Gerät eine Karte; Texte de/en. Commit(s) `feat(frontend): show devices and their readings`.

---

### Task 7: Stack-E2E und Doku

**Files:** `tests/e2e/specs/devices.spec.ts`, `tests/e2e/helpers/*`, Architektur-Spec 8.4/8.5 (Namenszuordnung über `bridge/devices`, `is_setting`, Stundenaggregat in 6b), `CLAUDE.md` (falls Befehle/Regeln neu), Spec 6a nur bei Abweichungen.

**E2E:** Plattform-Admin registriert das Simulator-Gateway (wie 5a Task 9) → Geräte zeigt „Neu erkannt“ mit sieben Einträgen (Namen „Pflanze 1“…„Lampe“) → „Pflanze 1“ hinzufügen → Bodenfeuchte erscheint auf Geräteseite und Übersicht (Simulator-Intervall im Stack-Test kurz) → ein Member desselben Haushalts sieht das Gerät, aber nicht „Neu erkannt“. Keine neuen Code-Anmeldungen (Limit 10/IP ausgeschöpft).

Commit(s) `test(infra): cover devices in the stack` und `docs: describe device discovery and readings`.

## Ergebnis und Übertrag

Umgesetzt subagent-gestützt (Sonnet für Umsetzung und Reviews, Haiku für kleine Nachprüfungen, Opus für das Gesamt-Review mit einer Nachbesserungsrunde). Reviews und die nächste Task liefen teils parallel; Task 7 hatte kein eigenes Review. Dieser Abschnitt hält fest, wo die Umsetzung vom Plan abweicht und was 5b und 6b übernehmen müssen.

### Abweichungen vom Plan (Entscheidungen)

- **MQTT 5 mit Subscription-Identifiern:** Überlappende Abos (Gateway-Status und Ingest) lieferten jede Nachricht doppelt; jetzt erreicht jede Kopie nur ihren eigenen Handler.
- **Gegendruck:** Der Ingest abonniert mit QoS 1 und quittiert erst nach der Verarbeitung; ein Burst von 5 000 Nachrichten kommt vollständig an (vorher 1 029). Beim Herunterfahren wird die Warteschlange abgearbeitet.
- **Retained Gerätenachrichten** zählen nur, wenn ihr eigenes `last_seen` neuer ist als der gespeicherte Stand.
- **Messwerte:** nur lesbare Nicht-Einstellungen; `binary` akzeptiert auch `ON`/`OFF` (Z2M-Lampe); `text`/`composite` nur im Zustand. Zustand von Hardware und Gerät rückt nur mit neuerer Messzeit vor.
- **`bridge/devices`** wird Eintrag für Eintrag gelesen; ein kaputter Eintrag (z. B. Gerät mit gescheitertem Interview) blockiert die Liste nicht.
- **`last_message_at`** zählt nur Geräteverkehr (keine `set`/`get`/`bridge/*`-Topics).
- **Oberfläche:** lazy Übersichtskarten (`OverviewCard` mit Lader); Hinzufügen-Knopf heißt „Hinzufügen“; Übersicht ohne Geräte führt zu „Geräte“.
- **Bundle:** initial rund 472,7 kB von 480 kB.

### Übertrag

- **5b (Pi):** Z2M auf `advanced.last_seen: ISO_8601` stellen – sonst trägt jeder echte Messwert die Empfangszeit (Flag `time_replaced`); QoS des echten Z2M prüfen; Nachliefer-Spitze am echten Aufbau prüfen (ADR-0020).
- **5b/6b:** dauerhafte MQTT-Sitzung des Backends (`clean: false`, feste Client-ID je Stack), sonst gehen Nachrichten während eines Backend-Neustarts verloren; Zeitlimit für hängende Verarbeitung (Quittung, Herunterfahren); `statement_timeout` der Datenbank.
- **6b:** Stundenaggregat, Diagramme, Räume, SSE, Befehle (Lampe), Kopplungsmodus; Binärwerte außer `true`/`false`/`ON`/`OFF` (z. B. `OPEN`/`CLOSE`) darstellen.

### Bewusst zurückgestellt (klein)

- Ingest: keine Wiederholung eines gescheiterten `follow` nach der Registrierung; Log-Menge bei vielen unbekannten Namen; Statusmeldungen warten hinter einer langen Nachlieferung (Latenz); kaputter `bridge/devices`-Eintrag markiert seine Hardware vorübergehend als entfernt.
- Writer: verworfene Zeilen werden erst beim nächsten Verwerfen gezählt.
- Oberfläche: ein synchron werfender Karten-Lader lässt die Übersicht leer; Überschriftenebenen und Listensemantik der Karten; geteilter Aktualisierungs-Status über Haushaltswechsel; doppelte Bausteine (Aktualisierung, „zuletzt gemeldet“); Gerät ohne Fähigkeiten zeigt keinen Hinweis.
- Tests: Sperren eines Gateways lässt ein anderes im selben Haushalt unberührt (nicht mehr geprüft); fehlende Tests für Namen über 60 Zeichen und widerrufene Gateways beim Hinzufügen.
