# Adapter-Schicht für Gateway-Arten – Design

- Status: freigegeben zur autonomen Umsetzung (Till, 2026-11-18, im Chat: Ansatz A „Adapter im Backend“, eigenes Fähigkeiten-Vokabular, mehrinstanzfähige Adapter als Regel, Z2M als erster Adapter; „lege mal richtig los … autonom“). Die Einzelentscheidungen in Abschnitt 11 hat Claude getroffen; Till prüft sie mit dem PR.
- Bezug: Architektur-Spec 4.3/4.4 (Broker, Topics), 8.4 (Datenmodell), 8.5 (Ingest), 8.6 (Befehle); ADR-0002, ADR-0003, ADR-0004, ADR-0006, ADR-0018, ADR-0020; Spec 6c-2 (Live)

## 1. Ziel

Die Plattform soll langfristig mehr als Pi + Zigbee2MQTT anbinden: als Nächstes Home Assistant, später vielleicht weitere Systeme (Hersteller-Hubs, eigene Bridges anderer). Dafür bekommt das Backend eine **Adapter-Schicht**:

- Jede Gateway-Art (`kind`) ist ein **Adapter** im Backend. Er übersetzt die Nachrichten seines Systems in neutrale Ereignisse und (ab 6c-3) neutrale Befehle zurück in sein Protokoll.
- Alles hinter dem Adapter (Hardware, Geräte, Messwerte, Hinweise, Live, Befehle) kennt nur noch neutrale Begriffe: eine stabile Hardware-ID, Fähigkeiten aus einem **eigenen Vokabular** mit festen Einheiten, Zustände mit neutralen Werten.
- **Zigbee2MQTT wird der erste Adapter.** Für den Pi, den Simulator und den Broker ändert sich nichts: Topics und Nutzlasten bleiben gleich.

**Erfolgskriterien**

1. Kein Code in `core/` kennt Zigbee2MQTT (Topics, `friendly_name`, IEEE-Adresse, `exposes`, `ON`/`OFF`, `last_seen`). Ein Test belegt das mit einem zweiten, nur für Tests gebauten Adapter, der Hardware, Zustände und Status über dieselbe Kette meldet.
2. Alle bisherigen Abläufe verhalten sich wie vorher (Ingest-, Geräte-, Hinweis-, Live- und Stack-Tests bleiben grün); die einzigen sichtbaren Änderungen stehen in Abschnitt 9.
3. Ein neuer Adapter braucht: ein Modul unter `apps/backend/src/adapters/<kind>/`, einen Eintrag in `GATEWAY_KINDS`, eine Zeile in `app.module.ts`, Übersetzungen für den Namen der Art. Sonst nichts in `core/`.

**Nicht in dieser Etappe:** Befehle (6c-3; hier nur die Schnittstelle als Vorgabe, Abschnitt 7), der Home-Assistant-Adapter und seine HA-Integration (eigene Spec), Broker-ACL für weitere Arten, Onboarding ohne Kommandozeile, mehrere Backend-Instanzen (nur Leitplanken, Abschnitt 8).

## 2. Begriffe

| Begriff                   | Bedeutung                                                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gateway-Art** (`kind`)  | Welches System hinter einem Gateway steckt, z. B. `z2m`. Bestimmt den Adapter und das Topic-Präfix `gw/<gatewayId>/<kind>`.                                                                    |
| **Adapter**               | Backend-Modul einer Gateway-Art. Übersetzt zwischen dem Protokoll der Art und den neutralen Ereignissen; hält selbst keinen Zustand.                                                           |
| **Externe ID**            | Stabile Kennung der Hardware im fremden System (Z2M: IEEE-Adresse). Eindeutig je Gateway, ändert sich nie.                                                                                     |
| **Adresse**               | Wie der Adapter die Hardware in Topics anspricht, darf sich ändern (Z2M: `friendly_name`). Optional.                                                                                           |
| **Kanonischer Schlüssel** | Name einer Fähigkeit im eigenen Vokabular (`soil_moisture`, `brightness`, …) mit fester Art und Einheit.                                                                                       |
| **Native Angaben**        | Was der Adapter je Hardware und je Fähigkeit über sein Protokoll wissen muss (Z2M: Property-Name, Werte für an/aus, Skala). Speichert der Kern, liest nur der Adapter, nie an Clients gegeben. |

## 3. Architektur

```
Broker ── gw/<id>/<kind>/# ──► GatewayIngest (core/devices) ──► Adapter (adapters/<kind>)
                                    │   Warteschlange, Quittung,        │  translate(): Topic + Nutzlast
                                    │   Sperre, Adressbuch              │  → neutrale Ereignisse
                                    ▼                                   │  decodeReport(): native Meldung
                           neutrale Ereignisse ◄────────────────────────┘  → kanonische Werte
                                    │
             HardwareRepository · DeviceReportProcessor · GatewaysRepository (touch)
                                    │
                 Geräte · Messwerte · Hinweise · Live (unverändert neutral)
```

### 3.1 Schichten und Abhängigkeiten

- **`core/adapters`** (neu): nur der Vertrag. Typen (`GatewayAdapter`, `AdapterEvent`, `ReportedHardware`, `ReportedCapability`, `StoredCapability`, `DecodedReport`), das Token `GATEWAY_ADAPTERS` und die `AdapterRegistry` (Adapter nach `kind`). Hängt nur von `@smart/contracts` ab.
- **`apps/backend/src/adapters/<kind>/`** (neue Elementart `be-adapter`): die Adapter. Dürfen `core/*` und `platform/*` über deren `index.ts` nutzen; nie einen anderen Adapter, nie `modules/*`.
- **Lint** (`tools/lint-config/eslint/backend-boundaries.mjs`, mit Test in `eslint-architecture.spec.mjs`): `core/*`, `platform/*` und `modules/*` dürfen nie von `adapters/*` abhängen; Adapter nie voneinander oder von `modules/*`; Zugriff nur über `index.ts`.
- **Registrierung:** `AdaptersModule.forRoot([Z2mAdapterModule])` in `app.module.ts` (global). Jedes Adaptermodul exportiert genau einen Provider, der `GatewayAdapter` implementiert; `forRoot` sammelt sie unter `GATEWAY_ADAPTERS`. Die Reihenfolge der Modul-Initialisierung spielt so keine Rolle: Die Registry steht fest, bevor ein `onModuleInit` läuft.
- `core/devices` (Ingest) und `core/gateways` (Status, Registrierung) importieren `core/adapters`. Die bisherige Schnittstelle `DeviceMessageHandler` entfällt; ihre Rolle übernimmt der neutrale `DeviceReportProcessor` (Abschnitt 5.3).

### 3.2 Der Adapter-Vertrag

```ts
/** One gateway kind, e.g. Zigbee2MQTT. Stateless: everything it needs comes in the arguments. */
export interface GatewayAdapter {
  readonly kind: GatewayKind;

  /** Topic below `gw/<id>/<kind>/` that carries the status of the gateway's service (may be retained). */
  readonly serviceStatusTopic: string;
  parseServiceStatus(payload: Buffer): GatewayStatus | undefined;

  /**
   * Whether a topic below the prefix is of use, and how big its payload may be. Decided before the
   * message is queued; `undefined` drops it without counting.
   */
  classify(topic: string): { maxBytes: number } | undefined;

  /** Turns one message into neutral events (none if it is of no use). Must not throw for bad input. */
  translate(message: AdapterMessage): AdapterEvent[];

  /** Turns the native fields of a report into canonical values, using what was stored at listing. */
  decodeReport(native: unknown, capabilities: readonly StoredCapability[]): DecodedReport;
}

export interface AdapterMessage {
  gatewayId: string;
  topic: string; // below the prefix, e.g. `Monstera` or `bridge/devices`
  payload: Buffer;
}

export type HardwareRef = { externalId: string } | { address: string };

export type AdapterEvent =
  /** The full list of the gateway's hardware: unlisted hardware counts as removed. */
  | { type: 'hardware.listed'; hardware: ReportedHardware[] }
  /** One piece of hardware joined or changed; others stay as they are. */
  | { type: 'hardware.joined'; externalId: string; address: string | null; name: string }
  | { type: 'hardware.setup'; externalId: string; setupState: SetupState }
  | { type: 'hardware.left'; externalId: string }
  /** The adapter's address changed (Z2M rename); `name` is the new name in the foreign system. */
  | { type: 'hardware.readdressed'; from: string; to: string; name: string }
  | { type: 'hardware.availability'; ref: HardwareRef; availability: Availability }
  /** A report of the hardware's state; `native` is decoded by `decodeReport` once the hardware is known. */
  | { type: 'hardware.report'; ref: HardwareRef; native: unknown }
  /** The gateway is alive (device traffic, not its own status or a command). */
  | { type: 'activity' };

export interface ReportedHardware {
  externalId: string;
  address: string | null;
  name: string;
  vendor: string;
  model: string;
  description: string | null;
  setupState: SetupState;
  /** Kept as reported for diagnosis and re-derivation; never sent to clients. */
  native: Record<string, unknown>;
  capabilities: ReportedCapability[];
}

/** A capability as stored: the neutral fields plus what only the adapter reads. */
export interface ReportedCapability extends Capability {
  native: Record<string, unknown>;
}
export type StoredCapability = ReportedCapability;

export interface DecodedReport {
  /** Canonical keys → values in the vocabulary's units; booleans for binary capabilities. */
  values: Record<string, unknown>;
  /** When the hardware measured, if it says so; the core checks plausibility. */
  measuredAt: Date | undefined;
}

export const SETUP_STATES = ['pairing', 'ready', 'failed', 'unknown'] as const;
```

- **Zustandslos:** Ein Adapter hält keinen Zustand zwischen Aufrufen. Was er je Hardware wissen muss, steht in den gespeicherten nativen Angaben und kommt mit `decodeReport` (und ab 6c-3 mit `encodeCommand`) zurück.
- **Robust:** `translate` und `decodeReport` werfen nie wegen fremder Eingaben; Ungültiges lassen sie weg. Was der Kern verwirft, zählt und protokolliert er wie bisher (gedrosselt, nie mit Nutzdaten).
- **Retained** bleibt Sache des Kerns (Abschnitt 5.3), der Adapter sieht das Flag nicht.

## 4. Fähigkeiten-Vokabular (`@smart/contracts`, `vocabulary.ts`)

Ein Eintrag legt Schlüssel, Art, Einheit, Wertebereich und Rolle fest; jeder Adapter bildet darauf ab. Die Schlüssel sind die bisher gespeicherten, so bleiben Verlauf, Schwellwerte und Übersetzungen gültig.

| Schlüssel       | Art     | Einheit | Bereich    | Rolle     | Bedeutung                    |
| --------------- | ------- | ------- | ---------- | --------- | ---------------------------- |
| `temperature`   | numeric | `°C`    | –          | Messwert  | Lufttemperatur               |
| `humidity`      | numeric | `%`     | 0–100      | Messwert  | relative Luftfeuchte         |
| `soil_moisture` | numeric | `%`     | 0–100      | Messwert  | Bodenfeuchte                 |
| `battery`       | numeric | `%`     | 0–100      | Messwert  | Batteriestand                |
| `linkquality`   | numeric | `lqi`   | 0–255      | Messwert  | Funkqualität (Zigbee-LQI)    |
| `contact`       | binary  | –       | –          | Messwert  | Kontakt geschlossen (`true`) |
| `state`         | binary  | –       | –          | Steuerung | an (`true`) / aus (`false`)  |
| `brightness`    | numeric | `%`     | 0–100      | Steuerung | Helligkeit                   |
| `color_temp`    | numeric | `K`     | 1000–10000 | Steuerung | Farbtemperatur in Kelvin     |

- **Werte:** `binary` ist immer `true`/`false` (nie `ON`/`OFF`), Zahlen in der Einheit des Eintrags. Ein Adapter rechnet um (Abschnitt 6.3).
- **Rolle:** Steuerungen sind nie Einstellungen (`isSetting: false`), auch wenn sie schreibbar sind. Ob eine Fähigkeit les- oder schreibbar ist, sagt der Adapter je Hardware.
- **Einheit, Art, Bereich** einer Fähigkeit mit kanonischem Schlüssel kommen aus dem Vokabular, nicht vom Adapter. Der Bereich darf vom Adapter enger gesetzt werden (Lampe mit 2200–4000 K).
- **Unbekanntes darf durch:** Was nicht im Vokabular steht, gibt der Adapter unter einem eigenen Schlüssel weiter (Muster `^[a-z][a-z0-9_]{0,63}$`), mit Art und Einheit aus seinem System. So gehen keine Messwerte verloren, die heute gespeichert werden (`dry` des Bodensensors). Ein durchgereichter Schlüssel darf nie ein Vokabular-Schlüssel sein: Bedeutet das native Feld etwas anderes, hängt der Adapter `_<kind>` an (`state_z2m` für den Zustand eines Schlosses).
- **Erweiterung:** Neue Einträge nur anhängen. Wird ein bisher durchgereichter Schlüssel kanonisch, prüft die Änderung, ob vorhandene Daten zur Einheit passen (sonst Datenmigration).
- `deviceKind`, `primaryCapability` und die Hinweis-Regeln arbeiten weiter mit diesen Schlüsseln; sie bekommen ihre Konstanten aus dem Vokabular statt aus Literalen.

## 5. Kern

### 5.1 Gateways (`core/gateways`)

- **Arten:** `GATEWAY_KINDS = ['z2m'] as const` wandert nach `@smart/contracts` (`gateways.ts`); `gatewaySchema.kind` wird `z.enum(GATEWAY_KINDS)`. Die Datenbank-Prüfung `gateways_kind_check` nutzt dieselbe Liste.
- **Registrierung:** `gatewayRegisterSchema` bekommt `kind` (optional, Standard `z2m`). Eine Art ohne geladenen Adapter lehnt das Backend mit `validation.failed` ab. Das Präfix ist `gw/<id>/<kind>`. Die Web-App sendet weiter keine Art (nur `z2m` existiert).
- **Status:** `z2m_status` heißt `service_status` (Spalte, Contract `serviceStatus`, Statusart `service` statt `z2m`). Bedeutung: die Software des Gateways hinter der Broker-Verbindung (Z2M, später die HA-Integration).
- **Status-Consumer:** abonniert `gw/+/bridge/connection` (unverändert) und je Adapter `gw/+/<kind>/<serviceStatusTopic>`, ausgewertet mit `parseServiceStatus`. Der Statusspeicher für noch nicht registrierte Gateways merkt sich die Art, unter der der Status kam; die Registrierung übernimmt ihn nur bei gleicher Art. Ein Status unter einer anderen Art als der registrierten wird ignoriert (gedrosselt protokolliert).
- **Lebenszeichen:** Das Abo `gw/+/z2m/#` im Status-Consumer entfällt. `last_message_at` setzt künftig der Ingest, wenn ein Adapter für eine nicht-retained Nachricht `activity` meldet (weiter höchstens einmal pro Minute, `GATEWAY_TOUCHED` wie bisher). Für nicht registrierte Gateways wurde `touch` schon bisher verworfen.
- `z2m-topics.ts` zieht in den Z2M-Adapter.

### 5.2 Hardware (`core/devices`, Tabellen)

| Bisher                                 | Neu                                  | Hinweis                                                                                                          |
| -------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `hardware.ieee_address`                | `hardware.external_id`               | eindeutig mit `gateway_id` (Index umbenannt)                                                                     |
| `hardware.friendly_name`               | `hardware.name` + `hardware.address` | `name`: Name im fremden System (Vorschlag beim Hinzufügen); `address`: Routing, nullable, Index mit `gateway_id` |
| `hardware.definition`                  | `hardware.native`                    | Z2M-Definition wie bisher, jetzt als native Angaben des Adapters                                                 |
| `hardware.interview_state`             | `hardware.setup_state`               | neutral: `pairing`, `ready`, `failed`, `unknown` (Check-Constraint)                                              |
| –                                      | `capabilities.native` (jsonb)        | native Angaben je Fähigkeit                                                                                      |
| Contract `ieeeAddress`, `friendlyName` | `externalId`, `name`                 | in `hardwareSchema`; `address` und `native` bleiben im Backend                                                   |

- `HardwareRepository.upsertFromBridge` heißt `replaceListed(gatewayId, ReportedHardware[], now)`, `recordJoined`, `setSetupState`, `markLeft`, `readdress` arbeiten mit externer ID bzw. Adresse. `capabilitiesOf` liefert `StoredCapability[]`.
- Das **Adressbuch** (bisher `NameMap`) bildet je Gateway Adresse → Hardware-ID ab, geladen aus der Datenbank beim Folgen und erneuert nach jeder Liste. Meldungen mit `{ externalId }` löst der Kern über die Datenbank auf (mit demselben Cache-Prinzip, Abschnitt 8).

### 5.3 Ingest (`core/devices/gateway-ingest.ts`, bisher `DeviceIngestConsumer`)

Bleibt in Ablauf und Garantien wie in Architektur-Spec 8.5 beschrieben (Abo je aktivem Gateway auf `<topicPrefix>/#`, QoS 1, Quittung nach Verarbeitung, 64-MiB-Sicherheitsnetz, Reihenfolge, Sperre, Herunterfahren). Neu ist nur, wer was entscheidet:

1. `accept`: Adapter des Gateways aus der Registry (nach `gateways.kind`); `adapter.classify(topic)` entscheidet, ob die Nachricht zählt und wie groß sie sein darf. Ein Gateway, dessen Art keinen Adapter hat, wird nicht abonniert (einmal protokolliert).
2. `process`: `adapter.translate(message)` → Ereignisse, die der Kern der Reihe nach anwendet:
   - `hardware.listed` → `replaceListed`, Adressbuch erneuern, gemerkte Verfügbarkeiten anwenden; eine Liste aus lauter ungültigen Einträgen meldet der Adapter gar nicht erst (wie bisher).
   - `hardware.joined`/`setup`/`left`/`readdressed` → wie bisher die Bridge-Ereignisse.
   - `hardware.availability` → Verfügbarkeit; unbekannte Adresse wird gemerkt, bis die Liste kommt (wie bisher).
   - `hardware.report` → Hardware auflösen (unbekannt: verwerfen und zählen wie bisher), gespeicherte Fähigkeiten laden, `adapter.decodeReport(native, capabilities)`, dann `DeviceReportProcessor.handle(…)`.
   - `activity` → nur bei nicht-retained Nachrichten: `GatewaysService.touch` (gedrosselt).
3. **`DeviceReportProcessor`** (bisher `DeviceMessageProcessor`): bekommt `values` und `measuredAt` statt der rohen Nutzlast. Prüft jeden Wert gegen die Fähigkeit (`binary` nur noch `true`/`false`), Zeitpunkt über `plausibleTime(measuredAt, receivedAt)` (bisher `measurementTime`: höchstens 2 min in der Zukunft, höchstens 7 Tage alt, sonst Empfangszeit mit Flag `time_replaced`), Retained-Regeln, Zustand und Messwerte wie bisher.

### 5.4 Übrige Kernstellen

- `attention.rules.ts`: `isTrue` kennt nur noch `true`; Gateway offline über `serviceStatus`.
- `devices.repository.ts` und `devices.service.ts`: Vorschlag des Gerätenamens aus `hardware.name`.
- Live-Ereignisse und ihre Auslöser bleiben gleich; `gateway.status` trägt `serviceStatus`.

## 6. Der Zigbee2MQTT-Adapter (`apps/backend/src/adapters/z2m/`)

### 6.1 Topics

Unverändert gegenüber heute (Architektur-Spec 8.5). `classify`:

| Topic (unter `gw/<id>/z2m/`)      | Ergebnis                                                                                 | Grenze |
| --------------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| `bridge/devices`                  | zählt                                                                                    | 4 MiB  |
| `bridge/event`                    | zählt                                                                                    | 64 KiB |
| sonstige `bridge/*`               | `undefined` (Status hört der Status-Consumer über `serviceStatusTopic = 'bridge/state'`) | –      |
| `<name>/availability`             | zählt                                                                                    | 1 KiB  |
| `…/set`, `…/get` (auch `…/set/x`) | `undefined`                                                                              | –      |
| `<name>`                          | zählt                                                                                    | 64 KiB |

`translate`:

- `bridge/devices` → ein `hardware.listed` (Koordinator ausgelassen, Einträge einzeln geprüft, eine Liste aus lauter ungültigen Einträgen ergibt kein Ereignis); `address` und `name` = `friendly_name`, `externalId` = IEEE-Adresse, `native` = Z2M-Definition, `setupState` aus `interview_state` (`SUCCESSFUL` → `ready`, `FAILED` → `failed`, `PENDING`/`IN_PROGRESS` → `pairing`, sonst `unknown`).
- `bridge/event` → `hardware.joined` (Setup `pairing`), `hardware.setup` (`started` → `pairing`, `successful` → `ready`, `failed` → `failed`), `hardware.left`, `hardware.readdressed` (`name` = neuer `friendly_name`).
- `<name>/availability` → `hardware.availability` mit `{ address: name }` und `activity`.
- `<name>` → `hardware.report` mit `{ address: name }` und der geparsten JSON-Nutzlast (kein Objekt: nichts) und `activity`. Auch für unbekannte Namen meldet der Adapter `activity` (heute zählt jede Gerätenachricht als Lebenszeichen).

### 6.2 Fähigkeiten aus `exposes`

`capabilitiesFromExposes` bleibt im Adapter (Flachklopfen, Zugriffsbits, Tiefengrenze, erstes Vorkommen gewinnt) und bildet zusätzlich auf das Vokabular ab:

- `state`, `brightness`, `color_temp` sind nur dann kanonisch, wenn sie Merkmal eines `light`- oder `switch`-Exposes sind; sonst gelten sie als durchgereicht mit `_z2m` (Abschnitt 4).
- `temperature`, `humidity`, `soil_moisture`, `battery`, `linkquality`, `contact` sind kanonisch, wenn die Z2M-Art zum Vokabular passt (numeric bzw. binary), sonst durchgereicht mit `_z2m`.
- Kanonische Fähigkeiten: Art, Einheit und Bereich aus dem Vokabular (Bereich der Lampe aus `value_min`/`value_max` umgerechnet), `isSetting: false` bei Steuerungen. Durchgereichte: wie heute (Einheit, Bereich, Werte aus dem Expose; `isSetting` nach der bisherigen Regel „lesbar, schreibbar, nicht binär“).
- `native` je Fähigkeit: `property` (Name im Z2M-Zustand), bei binären `valueOn`/`valueOff` aus dem Expose, bei `brightness` `max` (`value_max`, Standard 254).

### 6.3 `decodeReport`

- Je gespeicherter Fähigkeit mit `native.property` im Zustand: Wert übernehmen und umrechnen. Binär: `valueOn` → `true`, `valueOff` → `false`, Boolean bleibt; ohne gespeicherte Werte gelten `ON`/`OFF` (ältere Zeilen). `brightness`: `round(raw / max × 100)`. `color_temp`: `round(1 000 000 / mired)` (0 oder ungültig: weglassen). Alles andere unverändert; die Prüfung macht der Kern.
- `measuredAt` aus `last_seen`, nur ISO 8601 mit Zone (wie bisher); sonst `undefined`.

## 7. Vorgabe für 6c-3 (Befehle)

Nicht Teil dieser Etappe, aber der Vertrag ist darauf ausgelegt, damit 6c-3 nichts am Kern umbaut:

- Der Adapter bekommt `encodeCommand(target, value)`: `target` ist Hardware (externe ID, Adresse, native Angaben) plus gespeicherte Fähigkeit, `value` kanonisch (geprüft vom Kern gegen Vokabular und Bereich). Ergebnis: Topic unter dem Präfix und Nutzlast (Z2M: `<address>/set` mit `{ "<property>": <nativer Wert> }`).
- Die Bestätigung bleibt neutral im Kern: Der nächste dekodierte Bericht trägt den Sollwert → `confirmed` (Architektur-Spec 8.6), sonst nach 10 s `failed`.
- `MqttConnection` bekommt dafür `publish` (QoS 0). Der Kopplungsmodus wird `encodePairing(seconds)` des Adapters.
- Architektur-Spec 8.6 nennt heute `gw/<gw>/z2m/<ieee>/set`; richtig ist die Adresse (`friendly_name`), siehe Nachtrag.

## 8. Leitplanken für Wachstum (nicht gebaut)

- **Mehrere Backend-Instanzen:** Adapter sind zustandslos. Der Kern hält nur Caches, die er aus der Datenbank neu aufbauen kann (Adressbuch, gemerkte Verfügbarkeit mit Größengrenze). Wird später horizontal skaliert, verarbeitet je Gateway genau eine Instanz die Nachrichten (z. B. MQTT-Shared-Subscriptions mit Zuordnung nach Gateway), damit Reihenfolge und Caches stimmen.
- **Neue Gateway-Arten** brauchen ihre Broker-Rechte (`gw/%u/<kind>/#`); die ACL ändert die Spec der jeweiligen Art.
- **Onboarding ohne Kommandozeile** (Zertifikat per Kopplungscode) bekommt die Home-Assistant-Spec.
- **Neu ableiten:** Weil `hardware.native` die Rohbeschreibung behält, kann eine spätere Änderung des Vokabulars die Fähigkeiten aus den gespeicherten Angaben neu ableiten, ohne auf die nächste Geräteliste zu warten (nicht gebaut).

## 9. Migration und sichtbare Änderungen

**Datenbank (Migration `0010_adapter_layer.sql`, eine Transaktion):**

1. Spalten umbenennen (Abschnitt 5.2), `hardware.address` = bisheriger `friendly_name`, `setup_state` aus `interview_state` abbilden, `capabilities.native = {"property": key}` (bei `brightness` zusätzlich `max: 254`). Für binäre Fähigkeiten ohne gespeicherte Werte gilt im Adapter `ON`/`OFF` (Abschnitt 6.3).
2. Gerätezustände in `hardware.last_state` und `device_state.state`: `state` `"ON"`/`"OFF"` → `true`/`false`; `brightness` → Prozent (÷ 254, gerundet); `color_temp` → Kelvin.
3. Messwerte: `brightness` → Prozent, `color_temp` → Kelvin (`round(1e6 / value_num)`, Werte ≤ 0 bleiben unverändert). TimescaleDB erlaubt `UPDATE` auf komprimierten Chunks.
4. Fähigkeiten `brightness`/`color_temp`: Einheit, `min`, `max` umrechnen (bei Kelvin `min`/`max` vertauscht), `is_setting = false`.
5. Spalte `gateways.z2m_status` → `service_status`, Check-Constraints umbenennen.

**Aggregat:** Der Migrationsschritt (`src/migrate.ts`) ruft nach den Migrationen zusätzlich `refresh_continuous_aggregate('measurements_hourly', NULL, <letzte volle Stunde>)` auf. TimescaleDB rechnet dabei nur die durch das `UPDATE` ungültig gewordenen Bereiche neu; ohne Änderungen ist der Aufruf billig. Bei „concurrent refresh“ (Policy-Job läuft gerade) wiederholt der Schritt bis zu 50-mal im Abstand von 100 ms.

Die nächste `bridge/devices`-Liste nach dem Deploy schreibt Fähigkeiten und native Angaben ohnehin neu; die Migration sorgt nur dafür, dass bis dahin nichts falsch angezeigt wird.

**Sichtbar für Nutzer:**

- Helligkeit erscheint in `%`, Farbtemperatur in `K` (Pods, Geräteseite, Verlauf).
- Gateway-Seite: „Bridge: … · Zigbee2MQTT: …“ nimmt den Namen der Art aus der Übersetzung (`app.gateways.kind.z2m`); Text unverändert.
- Sonst nichts.

**Nicht betroffen:** Pi (`gateway/`), Simulator, Broker-Konfiguration und ACL, Topics, E2E-Specs (bis auf umbenannte Felder in Hilfsfunktionen).

## 10. Tests

- **Vertrag ohne Z2M:** Backend-Integrationstest, der statt des Z2M-Adapters einen Test-Adapter lädt. Er meldet sich unter der Art `z2m` (die Datenbank kennt nur diese Art), spricht aber ein ganz anderes Format (eigene Topics, eigene Nutzlasten, Werte schon kanonisch). Über ihn entstehen Hardware, Gerät, Messwerte, Verfügbarkeit, Service-Status und Lebenszeichen genauso wie mit Z2M; damit ist belegt, dass der Kern kein Z2M-Wissen braucht.
- **Z2M-Adapter (Unit):** `classify`, `translate` je Topic und Bridge-Ereignis, `capabilitiesFromExposes` mit Vokabular (Lampe, Bodensensor, Schloss mit `state`, Kontaktsensor, unbekannte Felder), `decodeReport` (an/aus, Helligkeit, Kelvin, `last_seen`, fehlerhafte Werte), `parseServiceStatus`.
- **Kern (Unit):** Ingest mit Fake-Adapter (Reihenfolge, Größen, Warteschlange, Sperre, `activity` nur ohne retained, unbekannte Art), `DeviceReportProcessor` (Booleans, Zeit, Retained), Status-Consumer je Adapter, Registrierung mit Art.
- **Migration:** Integrationstest auf TimescaleDB: Datenbank bis `0009` migrieren, Zeilen mit altem Format (auch in einem komprimierten Chunk) anlegen, `0010` anwenden, Ergebnis und Aggregat prüfen.
- **Bestehend:** Ingest-, Hardware-, Geräte-, Hinweis-, Live- und Gateway-E2E-Tests des Backends laufen mit Z2M-Nutzlasten wie bisher (nur Feldnamen angepasst); Stack-Test mit Simulator unverändert grün.
- **Lint:** Architekturtest für `be-adapter` (Kern → Adapter verboten, Adapter → Adapter verboten, Adapter → Kern über `index.ts` erlaubt).

## 11. Entscheidungen (autonom getroffen, zur Prüfung)

1. **Adapter im Backend, Teile zuhause dumm** (Ansatz A, mit Till besprochen). Kosten bei Irrtum: Übersetzungslogik in die Edge verschieben; der Vertrag bliebe gleich.
2. **Vokabular-Schlüssel = bisherige Schlüssel**, damit Verlauf, Schwellwerte und Übersetzungen ohne Migration weiterlaufen. `linkquality` bleibt trotz Zigbee-Bezug ein Eintrag (nur Zigbee-Systeme melden ihn). Kosten: Schlüsselnamen sind nicht überall „schön“.
3. **Helligkeit in Prozent, Farbtemperatur in Kelvin** statt Z2M-Rohwerten (0–254, Mired): neutral für HA (Kelvin, `brightness_pct`) und verständlich in der App; dafür Datenmigration der wenigen Lampen-Messwerte. Kosten bei Irrtum: Rückrechnung per Migration.
4. **Durchreichen statt Verwerfen** für Felder außerhalb des Vokabulars, Kollisionen mit `_<kind>`; Messwerte wie `dry` bleiben erhalten.
5. **`native` je Hardware und je Fähigkeit** statt Wissen im Adapter-Speicher: hält Adapter zustandslos und mehrinstanzfähig und trägt später die Befehle.
6. **Lebenszeichen über `activity` des Adapters** statt eines zweiten Wildcard-Abos: eine Abo-Kette weniger, gleiche Semantik.
7. **Neue Elementart `adapters/`** statt `modules/`: Module sind Fachfunktionen mit eigenen Tabellen, Adapter Infrastruktur einer Gateway-Art; getrennte Lint-Regeln machen die Grenze sichtbar.
8. **`interview_state` → neutraler `setup_state`**, obwohl ihn noch keine Oberfläche zeigt: Kopplung gibt es bei jeder Art.
9. **Broker-ACL bleibt** (nur `z2m`): Die Erweiterung gehört zur ersten weiteren Art, sonst öffnet sie Rechte ohne Nutzen.
