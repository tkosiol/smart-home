# Adapter-Schicht Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zigbee2MQTT wird der erste von mehreren Gateway-Adaptern; der Kern (Hardware, Geräte, Messwerte, Hinweise, Live) kennt nur noch neutrale Ereignisse, ein eigenes Fähigkeiten-Vokabular und neutrale Werte.

**Architecture:** Neuer Vertrag `core/adapters` (Typen, Registry), Adapter als eigene Elementart unter `apps/backend/src/adapters/<kind>/`, der bisherige Ingest-Consumer wird zum neutralen Host `GatewayIngest`, der Topics und Nutzlasten nur über den Adapter versteht. Datenbank: neutrale Spaltennamen, native Angaben je Hardware und Fähigkeit, Werte (Helligkeit %, Farbtemperatur K, Booleans) per Migration umgerechnet.

**Tech Stack:** NestJS 12.5, Drizzle 0.45 / drizzle-kit 0.31, TimescaleDB 2.30.2, zod/mini (Contracts), zod (Backend), Vitest + Testcontainers, Angular 22 (nur Feldnamen und ein Label), ESLint `eslint-plugin-boundaries`.

**Spec:** `docs/superpowers/specs/2026-11-18-adapter-schicht-design.md`

## Global Constraints

- Code, Bezeichner, Kommentare, Commits: Englisch; Doku in `docs/`: Deutsch. Conventional Commits mit Scope aus: repo, frontend, backend, contracts, ui, lint, infra, gateway, ci, docs, deps.
- Keine KI-Attribution in Commits (commitlint blockiert `Co-Authored-By: Claude` und „Generated with …“).
- Öffentliches Repo: keine IPs, privaten Hostnamen, E-Mail-Adressen, Secrets.
- Lint-Regeln nie abschalten; passt eine Regel nicht, wird sie in `tools/lint-config` mit Test angepasst.
- Backend-Architektur: `platform/` → nichts Fachliches; `core/*` → nie `modules/*` und (neu) nie `adapters/*`; Module und Adapter nie untereinander; fremde Elemente nur über deren `index.ts`.
- Kein Code in `apps/backend/src/core/` darf Zigbee2MQTT-Wissen enthalten: keine Topics `bridge/…`, kein `friendly_name`, keine IEEE-Adresse, keine `exposes`, kein `'ON'`/`'OFF'`, kein `last_seen` (Spec, Erfolgskriterium 1).
- Pi (`gateway/`), Simulator (`apps/gateway-simulator`), Broker (`infra/broker`) und Topics bleiben unverändert.
- Zeit: speichern/übertragen nur UTC; Tests laufen zusätzlich mit `TZ=Pacific/Chatham` (`pnpm test:tz`).
- Initiales Frontend-Bundle ≤ 425 kB (Stand rund 415,40 kB); dieser Plan darf es nicht nennenswert wachsen lassen.
- Nutzlasten werden nie protokolliert.
- Prüfen vor jedem Commit des Tasks: die im Task genannten Tests; vor dem Abschluss eines Tasks zusätzlich `pnpm lint && pnpm typecheck` im Repo-Wurzelverzeichnis (der Worktree hat eigene `node_modules`).
- Backend-Integrationstests brauchen Docker und OpenSSL ≥ 3 (`brew install openssl@3`, wird gefunden).

## Review Focus

1. **Migration auf echten Daten:** Hardware mit `friendly_name` ≠ IEEE-Adresse, Lampen mit Helligkeit 0 und 254, Farbtemperatur 0 (darf nicht durch 0 teilen), Zustände ohne `state`, komprimierte Chunks – nach `0010`/`0011` stimmt jede Zeile, und das Stundenaggregat zeigt die umgerechneten Werte (Task 4, Task 5).
2. **Retained-Nachrichten nach dem Umbau:** Eine retained Gerätenachricht ohne `last_seen` wird weiter ignoriert, eine retained mit älterem `last_seen` überschreibt keinen neueren Stand, und retained Nachrichten setzen nie `last_message_at` (Task 5).
3. **Umbenennung in Z2M während laufender Nachrichten:** `device_renamed` gefolgt von Nachrichten unter dem neuen Namen landen bei derselben Hardware; der alte Name führt nirgends mehr hin (Task 5).
4. **Gateway, dessen Art keinen Adapter hat** (z. B. Datenbankzeile mit künftiger Art nach einem Rollback): Der Ingest abonniert es nicht und stürzt nicht ab; der Status-Consumer ignoriert es (Task 5, Task 6).
5. **Lampe mit `state` außerhalb eines `light`-Exposes** (Schloss, Rollladen): wird nicht zum Licht, behält ihre Werte unter `state_z2m` (Task 3).

---

## Dateistruktur

| Datei                                                                      | Verantwortung                                                                                                                                      |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/vocabulary.ts` (neu)                               | Kanonische Fähigkeiten: Schlüssel, Art, Einheit, Bereich, Rolle; `isCanonicalKey`, `vocabularyEntry`, `PASS_THROUGH_KEY`                           |
| `packages/contracts/src/gateways.ts`                                       | `GATEWAY_KINDS`, `gatewayKindSchema`, `serviceStatus`, `kind` in Registrierung                                                                     |
| `packages/contracts/src/devices.ts`                                        | `hardwareSchema` mit `externalId`/`name`; Konstanten aus dem Vokabular                                                                             |
| `apps/backend/src/core/adapters/` (neu)                                    | `adapter.ts` (Vertrag), `adapter-registry.ts`, `adapters.module.ts`, `index.ts`, `README.md`                                                       |
| `apps/backend/src/adapters/z2m/` (neu)                                     | `z2m.adapter.ts`, `z2m-topics.ts`, `exposes.ts`, `bridge.ts` (Bridge-Schemas, Liste, Ereignisse), `decode.ts`, `z2m-adapter.module.ts`, `index.ts` |
| `apps/backend/src/adapters/README.md` (neu)                                | Regeln für Adapter                                                                                                                                 |
| `apps/backend/src/core/devices/gateway-ingest.ts`                          | neutraler Host (ersetzt `device-ingest.consumer.ts`)                                                                                               |
| `apps/backend/src/core/devices/device-report.processor.ts`                 | neutraler Prozessor (ersetzt `device-message.handler.ts` + `device-message-handler.ts`)                                                            |
| `apps/backend/src/core/devices/address-book.ts`                            | ersetzt `name-map.ts`                                                                                                                              |
| `apps/backend/src/core/devices/plausible-time.ts`                          | ersetzt `measurement-time.ts`                                                                                                                      |
| `apps/backend/drizzle/0010_adapter_layer.sql`, `0011_canonical_values.sql` | Struktur bzw. Werte                                                                                                                                |
| `tools/lint-config/eslint/backend-boundaries.mjs`                          | Elementart `be-adapter`                                                                                                                            |

---

### Task 1: Contracts – Vokabular, Gateway-Arten, neutrale Feldnamen

**Files:**

- Create: `packages/contracts/src/vocabulary.ts`, `packages/contracts/src/vocabulary.spec.ts`
- Modify: `packages/contracts/src/gateways.ts`, `packages/contracts/src/devices.ts`, `packages/contracts/src/index.ts` (Export), `packages/contracts/src/*.spec.ts` (betroffene Fixtures)
- Modify (Abnehmer, nur Feldnamen): `apps/backend/src/core/devices/devices.service.ts` (oder wo `Hardware`/`Gateway` gebaut werden: `toHardware`, `toGateway` – per `git grep -n "ieeeAddress\|friendlyName\|z2mStatus"` finden), `apps/backend/src/core/gateways/gateways.service.ts`, `apps/backend/src/core/attention/attention.rules.ts`, `apps/backend/src/core/attention/attention.service.ts`, Backend-Specs und `apps/backend/test/*.e2e-spec.ts`, die die Contract-Felder prüfen; `apps/frontend/src/app/features/devices/new-hardware.ts`, `devices-testing.ts`, `apps/frontend/src/app/features/gateways/gateway-status.ts`, `gateways-page.ts`, deren Specs; `tests/e2e/helpers/*` falls betroffen.

**Interfaces:**

- Produces (Contracts):
  - `CAPABILITY_VOCABULARY: readonly VocabularyEntry[]`, `interface VocabularyEntry { key; kind: 'numeric' | 'binary'; unit: string | null; min: number | null; max: number | null; role: 'reading' | 'control' }`
  - `CANONICAL_KEYS` (Tupel der Schlüssel), `type CanonicalKey`, `isCanonicalKey(key: string): key is CanonicalKey`, `vocabularyEntry(key: CanonicalKey): VocabularyEntry`
  - `CAPABILITY_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/`
  - `GATEWAY_KINDS = ['z2m'] as const`, `type GatewayKind`, `gatewayKindSchema`
  - `gatewaySchema`: `kind: gatewayKindSchema`, `serviceStatus` (statt `z2mStatus`)
  - `gatewayRegisterSchema`: `kind: z.optional(gatewayKindSchema)`
  - `hardwareSchema`: `externalId`, `name` (statt `ieeeAddress`, `friendlyName`)
- Backend liest in diesem Task noch die alten Spalten (`row.ieeeAddress` → `externalId`, `row.friendlyName` → `name`, `row.z2mStatus` → `serviceStatus`); Task 4 benennt die Spalten um.

- [ ] **Step 1: Failing test für das Vokabular** – `packages/contracts/src/vocabulary.spec.ts`:

```ts
import {
  CANONICAL_KEYS,
  CAPABILITY_KEY_PATTERN,
  CAPABILITY_VOCABULARY,
  isCanonicalKey,
  vocabularyEntry,
} from './vocabulary.js';

describe('capability vocabulary', () => {
  it('keeps the keys that are stored today', () => {
    expect(CANONICAL_KEYS).toEqual([
      'temperature',
      'humidity',
      'soil_moisture',
      'battery',
      'linkquality',
      'contact',
      'state',
      'brightness',
      'color_temp',
    ]);
  });

  it('fixes units and ranges', () => {
    expect(vocabularyEntry('temperature')).toMatchObject({
      kind: 'numeric',
      unit: '°C',
      min: null,
      max: null,
      role: 'reading',
    });
    expect(vocabularyEntry('soil_moisture')).toMatchObject({ unit: '%', min: 0, max: 100 });
    expect(vocabularyEntry('linkquality')).toMatchObject({ unit: 'lqi', min: 0, max: 255 });
    expect(vocabularyEntry('state')).toMatchObject({ kind: 'binary', unit: null, role: 'control' });
    expect(vocabularyEntry('brightness')).toMatchObject({
      kind: 'numeric',
      unit: '%',
      min: 0,
      max: 100,
      role: 'control',
    });
    expect(vocabularyEntry('color_temp')).toMatchObject({
      kind: 'numeric',
      unit: 'K',
      min: 1000,
      max: 10000,
      role: 'control',
    });
    expect(vocabularyEntry('contact')).toMatchObject({ kind: 'binary', role: 'reading' });
  });

  it('tells canonical keys apart', () => {
    expect(isCanonicalKey('brightness')).toBe(true);
    expect(isCanonicalKey('dry')).toBe(false);
    expect(isCanonicalKey('toString')).toBe(false);
  });

  it('only has keys that fit the key pattern', () => {
    for (const entry of CAPABILITY_VOCABULARY) expect(entry.key).toMatch(CAPABILITY_KEY_PATTERN);
    expect('state_z2m').toMatch(CAPABILITY_KEY_PATTERN);
    expect('State').not.toMatch(CAPABILITY_KEY_PATTERN);
    expect('a'.repeat(65)).not.toMatch(CAPABILITY_KEY_PATTERN);
  });
});
```

- [ ] **Step 2:** `pnpm --filter @smart/contracts test` → FAIL (Modul fehlt).

- [ ] **Step 3: Implementierung** – `packages/contracts/src/vocabulary.ts`:

```ts
/** The platform's own names for what devices measure or accept; every gateway adapter maps onto them. */
export interface VocabularyEntry {
  key: string;
  kind: 'numeric' | 'binary';
  unit: string | null;
  min: number | null;
  max: number | null;
  /** A control is switched or set by people; it is never a setting of the device. */
  role: 'reading' | 'control';
}

/**
 * Append only. The keys are the ones stored before the vocabulary existed, so history, thresholds
 * and translations keep working. Binary values are always `true`/`false`.
 */
export const CAPABILITY_VOCABULARY = [
  { key: 'temperature', kind: 'numeric', unit: '°C', min: null, max: null, role: 'reading' },
  { key: 'humidity', kind: 'numeric', unit: '%', min: 0, max: 100, role: 'reading' },
  { key: 'soil_moisture', kind: 'numeric', unit: '%', min: 0, max: 100, role: 'reading' },
  { key: 'battery', kind: 'numeric', unit: '%', min: 0, max: 100, role: 'reading' },
  { key: 'linkquality', kind: 'numeric', unit: 'lqi', min: 0, max: 255, role: 'reading' },
  { key: 'contact', kind: 'binary', unit: null, min: null, max: null, role: 'reading' },
  { key: 'state', kind: 'binary', unit: null, min: null, max: null, role: 'control' },
  { key: 'brightness', kind: 'numeric', unit: '%', min: 0, max: 100, role: 'control' },
  { key: 'color_temp', kind: 'numeric', unit: 'K', min: 1000, max: 10000, role: 'control' },
] as const satisfies readonly VocabularyEntry[];

export type CanonicalKey = (typeof CAPABILITY_VOCABULARY)[number]['key'];
export const CANONICAL_KEYS = CAPABILITY_VOCABULARY.map(
  (entry) => entry.key,
) as readonly CanonicalKey[];

/** What any capability key, canonical or passed through by an adapter, must look like. */
export const CAPABILITY_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

const BY_KEY = new Map<string, VocabularyEntry>(
  CAPABILITY_VOCABULARY.map((entry) => [entry.key, entry]),
);

export function isCanonicalKey(key: string): key is CanonicalKey {
  return BY_KEY.has(key);
}

export function vocabularyEntry(key: CanonicalKey): VocabularyEntry {
  // Every CanonicalKey is in the map by construction.
  return BY_KEY.get(key) as VocabularyEntry;
}
```

Export aus `packages/contracts/src/index.ts` ergänzen (gleicher Stil wie die anderen Exporte).

- [ ] **Step 4:** In `devices.ts` `PRIMARY_KEYS` und `deviceKind` mit `CanonicalKey`-typisierten Konstanten schreiben (Verhalten gleich; `satisfies readonly CanonicalKey[]`), `hardwareSchema` umbenennen:

```ts
export const hardwareSchema = z.object({
  id: z.string(),
  gatewayId: gatewayIdSchema,
  /** Stable ID of the hardware in the gateway's own system (Zigbee: the IEEE address). */
  externalId: z.string(),
  /** The name the gateway's own system gives it; suggested when it becomes a device. */
  name: z.string(),
  vendor: z.string(),
  // … rest unchanged
});
```

In `gateways.ts`:

```ts
export const GATEWAY_KINDS = ['z2m'] as const;
export type GatewayKind = (typeof GATEWAY_KINDS)[number];
export const gatewayKindSchema = z.enum(GATEWAY_KINDS);
// gatewaySchema: kind: gatewayKindSchema, serviceStatus: gatewayStatusSchema (statt z2mStatus),
// Kommentar: "The software behind the broker connection (Zigbee2MQTT, …)."
// gatewayRegisterSchema: kind: z.optional(gatewayKindSchema)
```

Contract-Specs (`devices.spec.ts`, `gateways.spec.ts`, `live.spec.ts`) auf die neuen Felder anpassen und je einen Fall ergänzen: `gatewaySchema` lehnt `kind: 'ha'` ab; `gatewayRegisterSchema` akzeptiert ohne `kind` und mit `kind: 'z2m'`.

- [ ] **Step 5:** `pnpm packages:build`, dann alle Abnehmer anpassen (Backend: Abbildung Zeile → Contract; `attention.rules.ts` Feld `z2mStatus` → `serviceStatus` in seinem Eingabetyp; Frontend: `friendlyName` → `name`, `z2mStatus` → `serviceStatus` – das i18n-Label bleibt in diesem Task gleich, nur der Parametername wird `service`: `"status": "Bridge: {{ bridge }} · Zigbee2MQTT: {{ service }}"` in `de.json` und `en.json`). `GATEWAY_KINDS` im Backend-Schema (`gateways.schema.ts`) aus den Contracts importieren statt selbst zu definieren.

- [ ] **Step 6:** `pnpm lint && pnpm typecheck && pnpm test` → alles grün (Backend-Integrationstests inklusive, die `ieeeAddress`/`friendlyName` im JSON prüfen, sind angepasst).

- [ ] **Step 7: Commit**

```bash
git add -A packages apps tests
git commit -m "feat(contracts): capability vocabulary, gateway kinds and neutral hardware fields"
```

---

### Task 2: Adapter-Vertrag `core/adapters` und Lint-Elementart

**Files:**

- Create: `apps/backend/src/core/adapters/adapter.ts`, `adapter-registry.ts`, `adapter-registry.spec.ts`, `adapters.module.ts`, `index.ts`, `README.md`
- Create: `apps/backend/src/adapters/README.md`
- Modify: `tools/lint-config/eslint/backend-boundaries.mjs`, `tools/lint-config/test/eslint-architecture.spec.mjs` (+ Fixture-Dateien unter `tools/lint-config/test/fixture` nach dem dortigen Muster)
- Modify: `apps/backend/src/core/README.md` (ein Satz: Adapter liegen unter `src/adapters/`)

**Interfaces:**

- Produces (aus `core/adapters/index.ts`):
  - Typen genau wie Spec 3.2: `GatewayAdapter`, `AdapterMessage`, `HardwareRef`, `AdapterEvent`, `ReportedHardware`, `ReportedCapability`, `StoredCapability`, `DecodedReport`, `SETUP_STATES`, `SetupState`
  - `GATEWAY_ADAPTERS` (Injection-Token, Wert `readonly GatewayAdapter[]`)
  - `AdapterRegistry` (Nest-Provider): `get(kind: string): GatewayAdapter | undefined`, `all(): readonly GatewayAdapter[]`; wirft im Konstruktor bei doppelter Art (`Error('Two adapters for gateway kind z2m')`).
  - `AdaptersModule.forRoot(modules: Type[], adapters: Type<GatewayAdapter>[]): DynamicModule` – `global: true`, importiert `modules`, stellt `GATEWAY_ADAPTERS` per `useFactory: (...list) => list, inject: adapters` und `AdapterRegistry` bereit, exportiert beide.

- [ ] **Step 1: Failing Registry-Test** – `adapter-registry.spec.ts`:

```ts
import type { GatewayAdapter } from './adapter.js';
import { AdapterRegistry } from './adapter-registry.js';

const fake = (kind: string): GatewayAdapter =>
  ({
    kind,
    serviceStatusTopic: 'status',
    parseServiceStatus: () => undefined,
    classify: () => undefined,
    translate: () => [],
    decodeReport: () => ({ values: {}, measuredAt: undefined }),
  }) as unknown as GatewayAdapter;

describe('AdapterRegistry', () => {
  it('finds adapters by kind', () => {
    const z2m = fake('z2m');
    const registry = new AdapterRegistry([z2m]);
    expect(registry.get('z2m')).toBe(z2m);
    expect(registry.get('ha')).toBeUndefined();
    expect(registry.all()).toEqual([z2m]);
  });

  it('refuses two adapters for one kind', () => {
    expect(() => new AdapterRegistry([fake('z2m'), fake('z2m')])).toThrow(
      'Two adapters for gateway kind z2m',
    );
  });
});
```

- [ ] **Step 2:** `pnpm --filter @smart/backend exec vitest run src/core/adapters` → FAIL.

- [ ] **Step 3:** `adapter.ts` mit den Typen aus Spec 3.2 (Kommentare übernehmen; `GatewayKind`, `GatewayStatus`, `Availability`, `Capability` aus `@smart/contracts`). `adapter-registry.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { GatewayAdapter } from './adapter.js';

export const GATEWAY_ADAPTERS = Symbol('GATEWAY_ADAPTERS');

/** The loaded gateway adapters by kind; fixed once the app is built. */
@Injectable()
export class AdapterRegistry {
  private readonly byKind = new Map<string, GatewayAdapter>();

  constructor(@Inject(GATEWAY_ADAPTERS) adapters: readonly GatewayAdapter[]) {
    for (const adapter of adapters) {
      if (this.byKind.has(adapter.kind))
        throw new Error(`Two adapters for gateway kind ${adapter.kind}`);
      this.byKind.set(adapter.kind, adapter);
    }
  }

  get(kind: string): GatewayAdapter | undefined {
    return this.byKind.get(kind);
  }

  all(): readonly GatewayAdapter[] {
    return [...this.byKind.values()];
  }
}
```

`adapters.module.ts`:

```ts
import { type DynamicModule, Module, type Type } from '@nestjs/common';
import type { GatewayAdapter } from './adapter.js';
import { AdapterRegistry, GATEWAY_ADAPTERS } from './adapter-registry.js';

/** Loads the gateway adapters; `app.module.ts` lists them once. Global, so core modules just inject the registry. */
@Module({})
export class AdaptersModule {
  static forRoot(modules: Type[], adapters: Type<GatewayAdapter>[]): DynamicModule {
    return {
      module: AdaptersModule,
      global: true,
      imports: modules,
      providers: [
        {
          provide: GATEWAY_ADAPTERS,
          useFactory: (...list: GatewayAdapter[]) => list,
          inject: adapters,
        },
        AdapterRegistry,
      ],
      exports: [GATEWAY_ADAPTERS, AdapterRegistry],
    };
  }
}
```

- [ ] **Step 4:** Registry-Test grün.

- [ ] **Step 5: Lint – failing Architekturtest.** In `eslint-architecture.spec.mjs` nach dem Muster der vorhandenen Backend-Fälle (Fixtures unter `tools/lint-config/test/fixture/apps/backend/src/…`) Fälle ergänzen:
  - `core/x/a.ts` importiert `../../adapters/z2m/index.js` → Fehler „core/\* must not depend on gateway adapters“
  - `adapters/z2m/a.ts` importiert `../ha/index.js` → Fehler „Gateway adapters must not depend on each other“
  - `adapters/z2m/a.ts` importiert `../../modules/plants/index.js` → Fehler „Gateway adapters must not depend on feature modules“
  - `modules/plants/a.ts` importiert `../../adapters/z2m/index.js` → Fehler „Feature modules must not depend on gateway adapters“
  - `platform/x/a.ts` importiert `../../adapters/z2m/index.js` → Fehler „platform/\* must not depend on core/\*, modules/\* or adapters/\*“
  - `adapters/z2m/a.ts` importiert `../../core/adapters/index.js` → kein Fehler
  - `adapters/z2m/a.ts` importiert `../../core/adapters/adapter.js` → Fehler „only through its public index.ts“

  `pnpm --filter @smart/lint-config test` (bzw. der Testbefehl aus `tools/lint-config/package.json`) → FAIL.

- [ ] **Step 6:** `backend-boundaries.mjs`: Element `{ type: 'be-adapter', pattern: 'apps/backend/src/adapters/*', capture: ['name'] }` vor `be-app`; `be-adapter` in die `index.ts`-Regel aufnehmen; Regeln: platform → nicht core/module/adapter (Meldung anpassen), core → nicht module, core → nicht adapter („core/\* must not depend on gateway adapters“), module → nicht module, module → nicht adapter, adapter → nicht adapter, adapter → nicht module. Tests grün.

- [ ] **Step 7:** READMEs. `apps/backend/src/adapters/README.md`:

```md
# adapters

One folder per gateway kind (`z2m`, later `ha`, …). An adapter translates between its system's
topics and payloads and the neutral contract in `core/adapters` (events in, commands out).

- Stateless: what it needs per piece of hardware is stored by the core (`native`) and handed back.
- May use `core/*` and `platform/*` through their `index.ts`; never another adapter or `modules/*`.
- Registered once in `app.module.ts` (`AdaptersModule.forRoot`); its kind is listed in `GATEWAY_KINDS`.
- Enforced by `boundaries/dependencies` (see `tools/lint-config`).
```

`core/adapters/README.md`: drei Sätze (Vertrag, Registry, keine Abhängigkeit außer Contracts).

- [ ] **Step 8:** `pnpm lint && pnpm typecheck`, dann Commit:

Zwei Commits: `feat(lint): keep gateway adapters apart from core and modules` (Lint + Tests) und `feat(backend): gateway adapter contract and registry` (Rest).

---

### Task 3: Zigbee2MQTT-Adapter (rein, noch nicht verdrahtet)

**Files:**

- Create: `apps/backend/src/adapters/z2m/z2m-topics.ts` (aus `core/gateways/z2m-topics.ts` übernommen samt Spec), `exposes.ts` + `exposes.spec.ts` (aus `core/devices/exposes.ts` übernommen und erweitert), `bridge.ts` + `bridge.spec.ts`, `decode.ts` + `decode.spec.ts`, `z2m.adapter.ts` + `z2m.adapter.spec.ts`, `z2m-adapter.module.ts`, `index.ts`
- Die alten Dateien in `core/` bleiben in diesem Task noch liegen (Task 5 entfernt sie).

**Interfaces:**

- Consumes: Task 1 (`CAPABILITY_VOCABULARY`, `isCanonicalKey`, `vocabularyEntry`, `CAPABILITY_KEY_PATTERN`), Task 2 (alle Vertragstypen)
- Produces: `Z2mAdapter implements GatewayAdapter` (`kind = 'z2m'`, `serviceStatusTopic = 'bridge/state'`), `Z2mAdapterModule` (Provider und Export `Z2mAdapter`), Export beider aus `adapters/z2m/index.ts`. Native Angaben:
  - Hardware: `native` = Z2M-`definition`-Objekt (`{}` ohne Definition)
  - Fähigkeit: `{ property: string; valueOn?: unknown; valueOff?: unknown; max?: number }`

- [ ] **Step 1: Failing Tests für `capabilitiesFromExposes`** (`exposes.spec.ts`; die bisherigen Fälle aus `core/devices/exposes.spec.ts` übernehmen und auf `ReportedCapability` erweitern, d. h. jedes Ergebnis hat `native`). Neue Fälle:

```ts
it('maps a light onto the vocabulary', () => {
  const caps = capabilitiesFromExposes([
    {
      type: 'light',
      features: [
        { type: 'binary', property: 'state', access: 7, value_on: 'ON', value_off: 'OFF' },
        { type: 'numeric', property: 'brightness', access: 7, value_min: 0, value_max: 254 },
        {
          type: 'numeric',
          property: 'color_temp',
          access: 7,
          value_min: 250,
          value_max: 454,
          unit: 'mired',
        },
      ],
    },
  ]);
  expect(caps).toEqual([
    {
      key: 'state',
      kind: 'binary',
      unit: null,
      min: null,
      max: null,
      step: null,
      enumValues: null,
      readable: true,
      writable: true,
      isSetting: false,
      native: { property: 'state', valueOn: 'ON', valueOff: 'OFF' },
    },
    {
      key: 'brightness',
      kind: 'numeric',
      unit: '%',
      min: 0,
      max: 100,
      step: null,
      enumValues: null,
      readable: true,
      writable: true,
      isSetting: false,
      native: { property: 'brightness', max: 254 },
    },
    {
      key: 'color_temp',
      kind: 'numeric',
      unit: 'K',
      min: 2203,
      max: 4000,
      step: null,
      enumValues: null,
      readable: true,
      writable: true,
      isSetting: false,
      native: { property: 'color_temp' },
    },
  ]);
});

it('keeps a lock state apart from a light', () => {
  const [lock] = capabilitiesFromExposes([
    {
      type: 'lock',
      features: [
        { type: 'binary', property: 'state', access: 7, value_on: 'LOCK', value_off: 'UNLOCK' },
      ],
    },
  ]);
  expect(lock).toMatchObject({
    key: 'state_z2m',
    kind: 'binary',
    native: { property: 'state', valueOn: 'LOCK', valueOff: 'UNLOCK' },
  });
});

it('takes unit and range of canonical readings from the vocabulary', () => {
  const caps = capabilitiesFromExposes([
    {
      type: 'numeric',
      property: 'soil_moisture',
      access: 1,
      unit: '%',
      value_min: 0,
      value_max: 100,
    },
    { type: 'numeric', property: 'battery', access: 1, unit: '%' },
    {
      type: 'numeric',
      property: 'linkquality',
      access: 1,
      unit: 'lqi',
      value_min: 0,
      value_max: 255,
    },
    { type: 'binary', property: 'contact', access: 1, value_on: false, value_off: true },
  ]);
  expect(caps.map((c) => [c.key, c.unit, c.min, c.max])).toEqual([
    ['soil_moisture', '%', 0, 100],
    ['battery', '%', 0, 100],
    ['linkquality', 'lqi', 0, 255],
    ['contact', null, null, null],
  ]);
  expect(caps[3]?.native).toEqual({ property: 'contact', valueOn: false, valueOff: true });
});

it('passes unknown readings and settings through', () => {
  const caps = capabilitiesFromExposes([
    { type: 'binary', property: 'dry', access: 1, value_on: true, value_off: false },
    { type: 'numeric', property: 'soil_calibration', access: 7, unit: '%' },
  ]);
  expect(caps[0]).toMatchObject({
    key: 'dry',
    kind: 'binary',
    isSetting: false,
    native: { property: 'dry', valueOn: true, valueOff: false },
  });
  expect(caps[1]).toMatchObject({
    key: 'soil_calibration',
    unit: '%',
    isSetting: true,
    native: { property: 'soil_calibration' },
  });
});

it('suffixes a canonical name whose kind does not fit', () => {
  const [enumState] = capabilitiesFromExposes([
    { type: 'enum', property: 'temperature', access: 1, values: ['low', 'high'] },
  ]);
  expect(enumState).toMatchObject({ key: 'temperature_z2m', kind: 'enum' });
});

it('drops properties that are no valid key', () => {
  expect(capabilitiesFromExposes([{ type: 'numeric', property: 'Weird Name', access: 1 }])).toEqual(
    [],
  );
});
```

`Expose` bekommt `value_on?: unknown`, `value_off?: unknown` (Schema: `z.unknown().optional()`).

- [ ] **Step 2:** `pnpm --filter @smart/backend exec vitest run src/adapters/z2m` → FAIL.

- [ ] **Step 3: Implementierung `exposes.ts`.** `visit(e, depth, parentType)` reicht den Typ des umgebenden Exposes (`light`, `switch`, `lock`, …) an die Merkmale weiter. Regeln je Blatt mit `property` (Reihenfolge):
  1. `property` passt nicht zu `CAPABILITY_KEY_PATTERN` → weglassen.
  2. Kanonisch, wenn `isCanonicalKey(property)` und die Z2M-Art passt (`numeric`↔`numeric`, `binary`↔`binary`) und – nur für `state`, `brightness`, `color_temp` – `parentType` ist `light` oder `switch`. Dann: `kind`/`unit`/`min`/`max` aus `vocabularyEntry`, `step: null`, `enumValues: null`, `isSetting: entry.role === 'reading' ? <bisherige Regel> : false`; Bereich der Lampe: `brightness` bleibt 0–100; `color_temp`: `min = value_max > 0 ? Math.round(1e6 / value_max) : entry.min`, `max = value_min > 0 ? Math.round(1e6 / value_min) : entry.max`.
  3. Sonst durchgereicht: Schlüssel `property`, außer `isCanonicalKey(property)` → `${property}_z2m`; Felder wie bisher; `isSetting` nach der bisherigen Regel (`readable && writable && type !== 'binary'`, ohne die Ausnahmeliste – die gilt jetzt über die Kanonik).
  4. `native`: `{ property }`, bei binär zusätzlich `valueOn`/`valueOff`, falls im Expose vorhanden; bei kanonischem `brightness` `max: value_max ?? 254`.
     `dedupeByKey` bleibt.

- [ ] **Step 4:** Tests grün.

- [ ] **Step 5: Failing Tests `decode.ts`** (`decodeZ2mReport(native: unknown, capabilities: readonly StoredCapability[]): DecodedReport`):

```ts
const cap = (
  key: string,
  kind: Capability['kind'],
  native: Record<string, unknown>,
): StoredCapability => ({
  key,
  kind,
  unit: null,
  min: null,
  max: null,
  step: null,
  enumValues: null,
  readable: true,
  writable: false,
  isSetting: false,
  native,
});
```

Nicht passende Werte gibt der Adapter **unverändert** weiter, damit der Kern sie zählt und verwirft:

```ts
it('turns on/off into booleans with the stored values', () => {
  const light = [cap('state', 'binary', { property: 'state', valueOn: 'ON', valueOff: 'OFF' })];
  expect(decodeZ2mReport({ state: 'ON' }, light).values).toEqual({ state: true });
  expect(decodeZ2mReport({ state: 'OFF' }, light).values).toEqual({ state: false });
  expect(decodeZ2mReport({ state: true }, light).values).toEqual({ state: true });
  expect(decodeZ2mReport({ state: 'TOGGLE' }, light).values).toEqual({ state: 'TOGGLE' });
  const lock = [
    cap('state_z2m', 'binary', { property: 'state', valueOn: 'LOCK', valueOff: 'UNLOCK' }),
  ];
  expect(decodeZ2mReport({ state: 'LOCK' }, lock).values).toEqual({ state_z2m: true });
});

it('falls back to ON/OFF for rows stored before the native values', () => {
  expect(
    decodeZ2mReport({ state: 'OFF' }, [cap('state', 'binary', { property: 'state' })]).values,
  ).toEqual({ state: false });
});

it('converts brightness and colour temperature', () => {
  const caps = [
    cap('brightness', 'numeric', { property: 'brightness', max: 254 }),
    cap('color_temp', 'numeric', { property: 'color_temp' }),
  ];
  expect(decodeZ2mReport({ brightness: 254, color_temp: 370 }, caps).values).toEqual({
    brightness: 100,
    color_temp: 2703,
  });
  expect(decodeZ2mReport({ brightness: 127, color_temp: 0 }, caps).values).toEqual({
    brightness: 50,
  });
  expect(decodeZ2mReport({ brightness: 'x' }, caps).values).toEqual({ brightness: 'x' });
});

it('keeps other fields as they are and ignores fields without a capability', () => {
  const caps = [cap('soil_moisture', 'numeric', { property: 'soil_moisture' })];
  expect(
    decodeZ2mReport(
      { soil_moisture: 41.5, last_seen: '2026-11-18T10:00:00+01:00', update: {} },
      caps,
    ).values,
  ).toEqual({ soil_moisture: 41.5 });
});

it('reads last_seen only with a zone', () => {
  expect(
    decodeZ2mReport({ last_seen: '2026-11-18T10:00:00+01:00' }, []).measuredAt?.toISOString(),
  ).toBe('2026-11-18T09:00:00.000Z');
  expect(decodeZ2mReport({ last_seen: '2026-11-18T10:00:00' }, []).measuredAt).toBeUndefined();
  expect(decodeZ2mReport({ last_seen: 1_700_000_000_000 }, []).measuredAt).toBeUndefined();
  expect(decodeZ2mReport('not an object', []).values).toEqual({});
});
```

Die ISO-Prüfung (mit Zone) übernimmt die Regel aus `core/devices/measurement-time.ts` (dort nachlesen und dieselbe Regex/Prüfung verwenden).

- [ ] **Step 6:** FAIL, dann implementieren: Für jede Fähigkeit mit `native.property` (String) und `Object.hasOwn(payload, property)`: Wert nehmen; `binary`: gleich `valueOn` → `true`, gleich `valueOff` → `false`, ohne gespeicherte Werte `'ON'`/`'OFF'`, Boolean bleibt, sonst unverändert; Schlüssel `brightness` (kanonisch) mit Zahl: `Math.round(raw / (native.max ?? 254) * 100)`; `color_temp` mit Zahl > 0: `Math.round(1e6 / raw)`, Zahl ≤ 0 → weglassen; sonst unverändert. → grün.

- [ ] **Step 7: Failing Tests `bridge.ts`** – `translateDevices(payload: Buffer): AdapterEvent[]` und `translateEvent(payload: Buffer): AdapterEvent[]`. Fälle aus `apps/backend/src/core/devices/device-ingest.consumer.spec.ts` übernehmen, die `bridge/devices` und `bridge/event` betreffen (gültige Liste, Koordinator ausgelassen, einzelne ungültige Einträge, lauter ungültige → `[]`, kein JSON → `[]`, `interview_state`-Abbildung, `device_joined` → `hardware.joined` mit `address`/`name` = `friendly_name` gefolgt von `{ type: 'hardware.setup', setupState: 'pairing' }`, `device_interview` je Status, `device_leave`, `device_renamed` → `{ type: 'hardware.readdressed', from, to, name: to }`, unbekannter Typ → `[]`). Erwartete Liste z. B.:

```ts
expect(
  translateDevices(
    Buffer.from(
      JSON.stringify([
        { ieee_address: '0x00124b0000000001', friendly_name: 'Coordinator', type: 'Coordinator' },
        {
          ieee_address: '0x00124b0000000002',
          friendly_name: 'Monstera',
          type: 'EndDevice',
          interview_state: 'SUCCESSFUL',
          definition: {
            vendor: 'TuYa',
            model: 'AY-303Z',
            description: 'Soil sensor',
            exposes: [{ type: 'numeric', property: 'soil_moisture', access: 1, unit: '%' }],
          },
        },
      ]),
    ),
  ),
).toEqual([
  {
    type: 'hardware.listed',
    hardware: [
      {
        externalId: '0x00124b0000000002',
        address: 'Monstera',
        name: 'Monstera',
        vendor: 'TuYa',
        model: 'AY-303Z',
        description: 'Soil sensor',
        setupState: 'ready',
        native: {
          vendor: 'TuYa',
          model: 'AY-303Z',
          description: 'Soil sensor',
          exposes: [{ type: 'numeric', property: 'soil_moisture', access: 1, unit: '%' }],
        },
        capabilities: [
          {
            key: 'soil_moisture',
            kind: 'numeric',
            unit: '%',
            min: 0,
            max: 100,
            step: null,
            enumValues: null,
            readable: true,
            writable: false,
            isSetting: false,
            native: { property: 'soil_moisture' },
          },
        ],
      },
    ],
  },
]);
```

`interview_state`: `SUCCESSFUL` → `ready`, `FAILED` → `failed`, `PENDING`/`IN_PROGRESS` → `pairing`, sonst/fehlend → `unknown`. Leere Liste `[]` → `[{ type: 'hardware.listed', hardware: [] }]` (alles entfernt, wie bisher).

- [ ] **Step 8:** FAIL, dann `bridge.ts` aus den Schemas und `toZ2mDevice` des bisherigen Consumers bauen (Schemas, `INTERVIEW_STATES` jetzt neutral abgebildet). → grün.

- [ ] **Step 9: Failing Tests `z2m.adapter.ts`:**

```ts
const adapter = new Z2mAdapter();
const msg = (topic: string, payload: string | object) => ({
  gatewayId: 'gw-test0001',
  topic,
  payload: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)),
});

it('classifies topics with their size limits', () => {
  expect(adapter.classify('bridge/devices')).toEqual({ maxBytes: 4 * 1024 * 1024 });
  expect(adapter.classify('bridge/event')).toEqual({ maxBytes: 64 * 1024 });
  expect(adapter.classify('bridge/state')).toBeUndefined();
  expect(adapter.classify('bridge/request/permit_join')).toBeUndefined();
  expect(adapter.classify('Monstera/availability')).toEqual({ maxBytes: 1024 });
  expect(adapter.classify('Monstera/set')).toBeUndefined();
  expect(adapter.classify('Monstera/set/brightness')).toBeUndefined();
  expect(adapter.classify('Monstera/get')).toBeUndefined();
  expect(adapter.classify('Monstera')).toEqual({ maxBytes: 64 * 1024 });
});

it('turns device messages into a report and a sign of life', () => {
  expect(adapter.translate(msg('Monstera', { soil_moisture: 40 }))).toEqual([
    { type: 'hardware.report', ref: { address: 'Monstera' }, native: { soil_moisture: 40 } },
    { type: 'activity' },
  ]);
  expect(adapter.translate(msg('Monstera', '[1,2]'))).toEqual([{ type: 'activity' }]);
  expect(adapter.translate(msg('Monstera', 'garbage'))).toEqual([{ type: 'activity' }]);
});

it('turns availability into events', () => {
  expect(adapter.translate(msg('Monstera/availability', 'offline'))).toEqual([
    { type: 'hardware.availability', ref: { address: 'Monstera' }, availability: 'offline' },
    { type: 'activity' },
  ]);
  expect(adapter.translate(msg('Monstera/availability', { state: 'online' }))[0]).toMatchObject({
    availability: 'online',
  });
  expect(adapter.translate(msg('Monstera/availability', 'maybe'))).toEqual([{ type: 'activity' }]);
});

it('reads the service status', () => {
  expect(adapter.serviceStatusTopic).toBe('bridge/state');
  expect(adapter.parseServiceStatus(Buffer.from('online'))).toBe('online');
  expect(adapter.parseServiceStatus(Buffer.from('{"state":"offline"}'))).toBe('offline');
  expect(adapter.parseServiceStatus(Buffer.from('x'.repeat(2000)))).toBeUndefined();
});
```

Ungültige Verfügbarkeit: Der bisherige Consumer zählte sie als `invalid`. Der Adapter liefert dafür kein Ereignis; das Zählen übernimmt der Kern nicht mehr für diesen Fall – das ist eine bewusste, kleine Verhaltensänderung (nur der Zähler `discarded.invalid`; Ruling im Ledger festhalten, Spec 3.2 „Ungültiges lassen sie weg“).

- [ ] **Step 10:** FAIL, dann `Z2mAdapter` implementieren (`@Injectable()`, keine Konstruktor-Abhängigkeiten): `classify` mit `isCommandTopic`/`isBridgeTopic` aus `z2m-topics.ts`; `translate` verteilt auf `translateDevices`, `translateEvent`, Verfügbarkeit (Parser aus dem bisherigen Consumer), Gerätenachricht; `decodeReport = decodeZ2mReport`; `parseServiceStatus` = bisheriges `parseBridgeState` aus `gateway-status.consumer.ts` (inkl. 1-KiB-Grenze). `z2m-adapter.module.ts`: `@Module({ providers: [Z2mAdapter], exports: [Z2mAdapter] })`. → grün.

- [ ] **Step 11:** `pnpm lint && pnpm typecheck`; Commit `feat(backend): zigbee2mqtt gateway adapter`.

---

### Task 4: Datenbank-Struktur neutral (Migration 0010)

**Files:**

- Create: `apps/backend/drizzle/0010_adapter_layer.sql`, `apps/backend/drizzle/meta/0010_snapshot.json`, Eintrag in `drizzle/meta/_journal.json`
- Create: `apps/backend/test/helpers/migrate-until.ts`, `apps/backend/test/adapter-layer-migration.e2e-spec.ts`
- Modify: `apps/backend/src/core/devices/devices.schema.ts`, `apps/backend/src/core/gateways/gateways.schema.ts`, `apps/backend/src/core/devices/hardware.repository.ts`, `devices.repository.ts`, `devices.service.ts`, `apps/backend/src/core/gateways/gateways.repository.ts`, `gateways.service.ts`, `gateway-status-memory.ts`, `gateway-status.consumer.ts` (nur Feld-/Spaltennamen), `apps/backend/src/core/devices/device-ingest.consumer.ts` (nur Aufrufe der umbenannten Repository-Methoden/Felder), alle betroffenen Specs und E2E-Specs.

**Interfaces:**

- Consumes: Task 1 (`GATEWAY_KINDS` aus Contracts), Task 2 (`SETUP_STATES`)
- Produces (Drizzle-Schema):
  - `hardware`: `externalId` (`external_id`), `name`, `address` (nullable), `native` (jsonb, `Record<string, unknown>`), `setupState` (`setup_state`, Enum `SETUP_STATES`, Default `'unknown'`, Check `hardware_setup_state_check`); Indizes `hardware_gateway_id_external_id_idx` (unique), `hardware_gateway_id_address_idx`
  - `capabilities.native` (jsonb, not null, default `{}`)
  - `gateways.serviceStatus` (`service_status`, Check `gateways_service_status_check`)
  - Repository: `HardwareRepository.listAddresses(gatewayId): Promise<{ id: string; address: string }[]>` (statt `listNames`; nur Zeilen mit `address is not null`), `recordJoined(gatewayId, externalId, address, name, now)`, `setSetupState(gatewayId, externalId, setupState)`, `markLeft(gatewayId, externalId, now): Promise<{ id; address: string | null } | undefined>`, `readdress(gatewayId, from, to, name): Promise<string | undefined>`, `findByAddress(gatewayId, address)` (statt `findByName`). `upsertFromBridge` bleibt in diesem Task (Feldnamen angepasst), Task 5 ersetzt es.
  - `StatusMemory`/`GatewayStatusKind`: `'bridge' | 'service'`, `RecalledStatus.service`; die Art bleibt in diesem Task `z2m` (Task 6 ergänzt sie).
  - Test-Helfer `migrateUntil(url: string, lastTag: string): Promise<void>` – migriert nur bis einschließlich der Migration mit diesem Tag (z. B. `'0009_measurements_hourly'`).

- [ ] **Step 1: Test-Helfer.** `migrate-until.ts`: kopiert `apps/backend/drizzle` in ein temporäres Verzeichnis (`fs.mkdtemp` unter `os.tmpdir()`), kürzt `meta/_journal.json` auf die Einträge bis `lastTag`, löscht die übrigen `.sql`, ruft `migrate()` aus `drizzle-orm/postgres-js/migrator` mit demselben Schema/Tabelle wie `runMigrations` (`src/platform/database/migrations.ts`) auf. Danach führt ein normales `runMigrations(url)` die restlichen aus (Drizzle merkt sich die angewandten per Hash/Zeitstempel).

- [ ] **Step 2: Failing Migrationstest** `adapter-layer-migration.e2e-spec.ts` (Muster: `measurements-hourly.e2e-spec.ts`, `createFreshDatabase`):
  - `migrateUntil(url, '0009_measurements_hourly')`
  - Haushalt, Gateway (`id 'gw-mig00001'`, `topic_prefix 'gw/gw-mig00001/z2m'`, `z2m_status 'online'`), zwei Hardware-Zeilen (`ieee_address '0x00124b0000000001'`, `friendly_name 'Monstera'`, `interview_state 'SUCCESSFUL'`; die zweite `'IN_PROGRESS'`), Fähigkeiten `soil_moisture` und `state` per SQL anlegen (Spaltennamen alt).
  - `runMigrations(url)`
  - Erwartet: `external_id = '0x00124b0000000001'`, `name = 'Monstera'`, `address = 'Monstera'`, `setup_state` `ready` bzw. `pairing`, `native` = vorherige `definition`; `capabilities.native = {"property": "soil_moisture"}`; `gateways.service_status = 'online'`; Insert mit `setup_state 'SUCCESSFUL'` scheitert am Check.
    → FAIL (`0010` fehlt).

- [ ] **Step 3: Migration schreiben.** `drizzle-kit generate` fragt bei Umbenennungen interaktiv und läuft hier nicht; daher von Hand:
  1. `pnpm --filter @smart/backend exec drizzle-kit generate --custom --name adapter_layer` (legt leere `0010_adapter_layer.sql`, Journal-Eintrag und Snapshot an).
  2. SQL eintragen:

```sql
ALTER TABLE "hardware" RENAME COLUMN "ieee_address" TO "external_id";--> statement-breakpoint
ALTER TABLE "hardware" RENAME COLUMN "friendly_name" TO "name";--> statement-breakpoint
ALTER TABLE "hardware" RENAME COLUMN "definition" TO "native";--> statement-breakpoint
ALTER TABLE "hardware" ADD COLUMN "address" text;--> statement-breakpoint
UPDATE "hardware" SET "address" = "name";--> statement-breakpoint
ALTER TABLE "hardware" RENAME COLUMN "interview_state" TO "setup_state";--> statement-breakpoint
UPDATE "hardware" SET "setup_state" = CASE "setup_state"
  WHEN 'SUCCESSFUL' THEN 'ready'
  WHEN 'FAILED' THEN 'failed'
  WHEN 'PENDING' THEN 'pairing'
  WHEN 'IN_PROGRESS' THEN 'pairing'
  ELSE 'unknown' END;--> statement-breakpoint
ALTER TABLE "hardware" ALTER COLUMN "setup_state" SET DEFAULT 'unknown';--> statement-breakpoint
ALTER TABLE "hardware" ADD CONSTRAINT "hardware_setup_state_check" CHECK ("hardware"."setup_state" in ('pairing', 'ready', 'failed', 'unknown'));--> statement-breakpoint
ALTER INDEX "hardware_gateway_id_ieee_address_idx" RENAME TO "hardware_gateway_id_external_id_idx";--> statement-breakpoint
DROP INDEX "hardware_gateway_id_friendly_name_idx";--> statement-breakpoint
CREATE INDEX "hardware_gateway_id_address_idx" ON "hardware" USING btree ("gateway_id","address");--> statement-breakpoint
ALTER TABLE "capabilities" ADD COLUMN "native" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "capabilities" SET "native" = jsonb_build_object('property', "key");--> statement-breakpoint
ALTER TABLE "gateways" RENAME COLUMN "z2m_status" TO "service_status";--> statement-breakpoint
ALTER TABLE "gateways" RENAME CONSTRAINT "gateways_z2m_status_check" TO "gateways_service_status_check";
```

3. Drizzle-Schema (`devices.schema.ts`, `gateways.schema.ts`) wie unter „Produces“ ändern (Kommentare: `native` = „What the gateway's adapter reported, kept for diagnosis; only the adapter reads it.“, `address` = „How the adapter addresses the hardware in its topics (Zigbee2MQTT: friendly_name); may change.“).
4. `meta/0010_snapshot.json` so bearbeiten, dass er dem neuen Schema entspricht (Spalten/Indizes/Checks umbenennen bzw. ergänzen; `id`/`prevId` unverändert lassen).
5. Prüfen: `pnpm --filter @smart/backend exec drizzle-kit generate` meldet „No schema changes, nothing to migrate“. Sonst Snapshot korrigieren, bis es so ist (keine zusätzliche Migration erzeugen; eine versehentlich erzeugte Datei samt Journal-Eintrag wieder entfernen).

- [ ] **Step 4:** Migrationstest grün.

- [ ] **Step 5:** Repository-/Service-Code und alle Specs auf die neuen Spalten umstellen (Methoden wie unter „Produces“; der Ingest-Consumer ruft vorerst `listAddresses` statt `listNames` und schreibt beim Join `setupState: 'pairing'`, beim Interview den neutralen Wert über eine lokale Abbildung – diese Abbildung zieht in Task 5 in den Adapter). Bisherige Z2M-Werte `'PENDING'`/`'SUCCESSFUL'` in Tests durch neutrale ersetzen.

- [ ] **Step 6:** `pnpm --filter @smart/backend test` (Unit + E2E) grün, `pnpm lint && pnpm typecheck` grün. Commit `refactor(backend): neutral hardware and gateway columns`.

---

### Task 5: Neutraler Ingest, Verdrahtung, kanonische Werte (Migration 0011)

**Files:**

- Create: `apps/backend/src/core/devices/gateway-ingest.ts` (+ `.spec.ts`), `device-report.processor.ts` (+ `.spec.ts`), `address-book.ts` (+ `.spec.ts`), `plausible-time.ts` (+ `.spec.ts`)
- Delete: `apps/backend/src/core/devices/device-ingest.consumer.ts` (+ spec), `device-message.handler.ts` (+ spec), `device-message-handler.ts`, `name-map.ts` (+ spec), `measurement-time.ts` (+ spec), `exposes.ts` (+ spec); `apps/backend/src/core/gateways/z2m-topics.ts` (+ spec) und dessen Export aus `core/gateways/index.ts`
- Modify: `hardware.repository.ts` (`replaceListed` statt `upsertFromBridge`, `capabilitiesOf` → `StoredCapability[]`, `native` in Fähigkeiten speichern), `devices.module.ts`, `core/devices/index.ts`, `apps/backend/src/app.module.ts`, `apps/backend/src/core/attention/attention.rules.ts` (`isTrue` nur `true`), `apps/backend/src/migrate.ts`, `apps/backend/src/core/telemetry/hourly-backfill.ts` (+ Export), E2E-Specs mit Lampenwerten
- Create: `apps/backend/drizzle/0011_canonical_values.sql` (+ Snapshot/Journal per `--custom`), `apps/backend/test/canonical-values-migration.e2e-spec.ts`

**Interfaces:**

- Consumes: Task 2 (`AdapterRegistry`, Vertragstypen), Task 3 (`Z2mAdapterModule`, `Z2mAdapter`), Task 4 (Repository-Methoden)
- Produces:
  - `GatewayIngest` (Nest-Provider, ersetzt `DeviceIngestConsumer`; öffentliche Teile wie bisher: `idle()`, `discarded`, `onModuleInit`, `onModuleDestroy`, `SHUTDOWN_DRAIN_MS`)
  - `DeviceReportProcessor.handle(input: { gatewayId: string; hardwareId: string; values: Record<string, unknown>; measuredAt: Date | undefined; receivedAt: Date; retained: boolean }): Promise<void>`; Zähler `discardedFields`
  - `plausibleTime(measuredAt: Date | undefined, receivedAt: Date): { time: Date; replaced: boolean }`
  - `AddressBook` (Methoden wie `NameMap`, mit `address` statt `friendlyName`: `replace(gatewayId, entries: Iterable<{ address: string; id: string }>)`, `lookup`, `set`, `remove`, `move(gatewayId, from, to, hardwareId)`, `forget`)
  - `HardwareRepository.replaceListed(gatewayId: string, hardware: readonly ReportedHardware[], now: Date): Promise<{ ids: string[] }>`, `capabilitiesOf(hardwareId): Promise<StoredCapability[]>`, `findByExternalId(gatewayId, externalId): Promise<string | undefined>`
  - `backfillHourly` refresht zusätzlich invalidierte Bereiche (siehe Step 9)

- [ ] **Step 1: `plausible-time` (TDD).** Fälle aus `measurement-time.spec.ts` übertragen (Eingabe jetzt `Date | undefined`): `undefined` → Empfangszeit, `replaced: true`; mehr als 2 min in der Zukunft → ersetzt; älter als 7 Tage → ersetzt; sonst übernommen. FAIL → implementieren → grün.

- [ ] **Step 2: `address-book` (TDD).** Fälle aus `name-map.spec.ts` übertragen und umbenennen. FAIL → implementieren → grün.

- [ ] **Step 3: `DeviceReportProcessor` (TDD).** Fälle aus `device-message.handler.spec.ts` übertragen, Eingabe jetzt `values` + `measuredAt`. Anpassungen:
  - binär gültig nur `true`/`false`; `'ON'` wird jetzt verworfen und gezählt (neuer Fall).
  - Lesbare Fähigkeit, die eine Einstellung ist: im Zustand, kein Messwert (wie bisher).
  - Felder ohne Fähigkeit werden ohne Zählen weggelassen (wie bisher).
  - Retained ohne Zeit → ignoriert; retained mit Zeit nur, wenn neuer (wie bisher).
  - Messwert für `state: true` → `valueNum: 1`.
    FAIL → implementieren (aus `DeviceMessageProcessor` umbauen; `ON`/`OFF`-Konstanten entfallen; `measurementTime(payload.last_seen, …)` → `plausibleTime(measuredAt, receivedAt)`) → grün.

- [ ] **Step 4: `HardwareRepository.replaceListed`** (Integrationstest in der vorhandenen `apps/backend/test/hardware-ingest.e2e-spec.ts` oder einem neuen `hardware-repository.e2e-spec.ts`): speichert `externalId`, `address`, `name`, `vendor`, `model`, `description`, `native`, `setupState` und Fähigkeiten mit `native`; nicht gelistete Hardware bekommt `removed_at`; gleiche externe ID doppelt → letzte gewinnt; `capabilitiesOf` liefert `native` zurück. FAIL → umbauen (`upsertFromBridge` entfernen) → grün.

- [ ] **Step 5: `GatewayIngest` (TDD, Unit mit Fake-Adapter und Fakes für Repository/Prozessor/MQTT wie in der bisherigen `device-ingest.consumer.spec.ts`).** Die bisherigen Fälle übertragen, aber über einen Fake-Adapter formuliert (Topics und Nutzlasten des Fakes frei wählbar, z. B. `list`, `dev/<addr>`, `avail/<addr>`), damit der Kern-Test ohne Z2M auskommt. Pflichtfälle:
  - abonniert `<topicPrefix>/#` je aktivem Gateway mit QoS 1 und `ackAfterHandler`; auch nach `GATEWAY_REGISTERED`; hört nach `GATEWAY_REVOKED` sofort auf
  - Gateway mit Art ohne Adapter wird nicht abonniert, einmal protokolliert, kein Absturz (Review Focus 4)
  - `classify` → `undefined`: nicht verarbeitet, nicht gezählt; Nutzlast größer `maxBytes`: verworfen, gezählt als `invalid`
  - 64-MiB-Netz: darüber `overflow`
  - Reihenfolge: Liste vor Bericht wird eingehalten, auch wenn der Repository-Aufruf langsam ist
  - `hardware.listed` → `replaceListed`, Adressbuch erneuert, gemerkte Verfügbarkeit angewendet, `HARDWARE_CHANGED` je ID
  - `hardware.readdressed` → Repository `readdress`, danach landen Berichte unter der neuen Adresse bei derselben Hardware, unter der alten werden sie als `unknownName` verworfen (Review Focus 3)
  - `hardware.report` mit unbekannter Adresse → `unknownName`; mit bekannter → `capabilitiesOf`, `adapter.decodeReport` mit genau diesen Fähigkeiten, Prozessor mit `values`/`measuredAt`/`retained`
  - `hardware.report` und `hardware.availability` mit `{ externalId }` → über `findByExternalId` aufgelöst (unbekannt: `unknownName`)
  - `activity` bei nicht-retained → `GatewaysService.touch` höchstens einmal pro Minute je Gateway, `GATEWAY_TOUCHED` bei Erfolg; bei retained nie (Review Focus 2)
  - Herunterfahren wartet auf die Warteschlange (bis `SHUTDOWN_DRAIN_MS`)

  FAIL → implementieren. Gerüst (Rest aus dem bisherigen Consumer übernehmen: Warteschlange, `control`, `follow`, `unfollow`, `shutDown`, `discard`, `drop`):

```ts
private accept(gatewayId: string, adapter: GatewayAdapter, topicPrefix: string, topic: string, payload: Buffer, retained: boolean): Promise<void> | undefined {
  const rest = topic.slice(topicPrefix.length + 1);
  if (!topic.startsWith(`${topicPrefix}/`) || rest === '') return;
  const route = adapter.classify(rest);
  if (route === undefined) return;
  if (payload.length > route.maxBytes) {
    this.discard('invalid', gatewayId, 'oversized');
    return;
  }
  // … queue as before, then:
  //   this.process(gatewayId, adapter, { gatewayId, topic: rest, payload }, retained)
}

private async process(gatewayId: string, adapter: GatewayAdapter, message: AdapterMessage, retained: boolean): Promise<void> {
  if (!this.subscriptions.has(gatewayId)) return;
  for (const event of adapter.translate(message)) {
    if (!this.subscriptions.has(gatewayId)) return;
    await this.apply(gatewayId, adapter, event, retained);
  }
}

private async apply(gatewayId: string, adapter: GatewayAdapter, event: AdapterEvent, retained: boolean): Promise<void> {
  switch (event.type) {
    case 'hardware.listed': return this.onListed(gatewayId, event.hardware);
    case 'hardware.joined': return this.onJoined(gatewayId, event);
    case 'hardware.setup': return this.onSetup(gatewayId, event);
    case 'hardware.left': return this.onLeft(gatewayId, event.externalId);
    case 'hardware.readdressed': return this.onReaddressed(gatewayId, event);
    case 'hardware.availability': return this.onAvailability(gatewayId, event.ref, event.availability);
    case 'hardware.report': return this.onReport(gatewayId, adapter, event.ref, event.native, retained);
    case 'activity': if (!retained) this.onActivity(gatewayId); return;
  }
}
```

`GatewaysService.touch` (bzw. `GatewaysRepository.touch` – nimm, was `GatewayStatusConsumer.onActivity` heute nutzt, und exportiere es über `core/gateways/index.ts`, falls nötig) samt `GATEWAY_TOUCHED`-Ereignis; Drosselung über `Throttle(MINUTE_MS, STATUS_MEMORY_LIMIT)`. Der Adapter eines Gateways kommt aus `this.adapters.get(gateway.kind)` (Liste aktiver Gateways und `GatewayRegistered` müssen dafür `kind` tragen: `GatewayRegistered` um `kind: GatewayKind` erweitern, `GatewaysService.register` setzt es; `listActive` liefert `kind`). → grün.

- [ ] **Step 6: Verdrahtung.** `devices.module.ts`: `GatewayIngest`, `DeviceReportProcessor` statt der alten Provider; `app.module.ts`: `AdaptersModule.forRoot([Z2mAdapterModule], [Z2mAdapter])` vor `DevicesModule` in die Imports (Kommentar: „Gateway kinds; each adapter is listed here once.“). Alte Dateien löschen. `git grep -n -E "friendly|ieee|exposes|'ON'|last_seen|bridge/" -- apps/backend/src/core` → keine Treffer außer Kommentaren, die neutral formuliert werden (Ziel: keine Treffer).

- [ ] **Step 7: Bestehende E2E-Tests** (`device-ingest.e2e-spec.ts`, `hardware-ingest.e2e-spec.ts`, `device-telemetry.e2e-spec.ts`, `device-ingest-load.e2e-spec.ts`, `live.e2e-spec.ts`, `attention.e2e-spec.ts`, `devices-api.e2e-spec.ts`) laufen mit echten Z2M-Nutzlasten über den Broker. Erwartungen an Lampen anpassen: `state` jetzt `true`/`false`, `brightness` in Prozent, `color_temp` in Kelvin; Kapazitäten der Lampe mit Vokabular-Einheiten. Alles andere bleibt. `pnpm --filter @smart/backend test` → grün.

- [ ] **Step 8: Migration 0011 (TDD).** `canonical-values-migration.e2e-spec.ts`: `migrateUntil(url, '0010_adapter_layer')`, dann anlegen: Gerät + Hardware mit `last_state` `{"state":"ON","brightness":254,"color_temp":370}`, `device_state.state` `{"state":"OFF","brightness":0,"color_temp":0}`, Fähigkeiten `brightness` (unit null, min 0, max 254), `color_temp` (unit `'mired'`, min 250, max 454), `state` (binary), Messwerte `brightness` 254 und 127, `color_temp` 370 und 0, `soil_moisture` 40; einen Chunk komprimieren (`select compress_chunk(c) from show_chunks('measurements') c`), Stundenaggregat für den Zeitraum refreshen. Dann `runMigrations(url)` und `backfillHourly(url)`. Erwartet:
  - `last_state` `{"state":true,"brightness":100,"color_temp":2703}`, `device_state.state` `{"state":false,"brightness":0,"color_temp":0}` (0 bleibt 0)
  - Fähigkeiten: `brightness` `%`/0/100/`is_setting false`/`native.max = 254`; `color_temp` `K`/2203/4000
  - Messwerte: `brightness` 100 und 50, `color_temp` 2703 und 0, `soil_moisture` 40 unverändert
  - `measurements_hourly` für `brightness` zeigt `max = 100`
    FAIL → `0011_canonical_values.sql` (per `drizzle-kit generate --custom --name canonical_values`; Snapshot = Kopie von 0010, nur `id`/`prevId` wie generiert):

```sql
-- Hand-written: values move to the platform's own units (spec 2026-11-18-adapter-schicht, section 9).
UPDATE "measurements" SET "value_num" = round("value_num" * 100 / 254)
  WHERE "capability" = 'brightness' AND "value_num" IS NOT NULL;--> statement-breakpoint
UPDATE "measurements" SET "value_num" = round(1000000 / "value_num")
  WHERE "capability" = 'color_temp' AND "value_num" > 0;--> statement-breakpoint
UPDATE "hardware" SET "last_state" = "last_state" || jsonb_build_object('state', "last_state"->>'state' = 'ON')
  WHERE "last_state"->>'state' IN ('ON', 'OFF');--> statement-breakpoint
UPDATE "device_state" SET "state" = "state" || jsonb_build_object('state', "state"->>'state' = 'ON')
  WHERE "state"->>'state' IN ('ON', 'OFF');--> statement-breakpoint
UPDATE "hardware" SET "last_state" = "last_state" || jsonb_build_object('brightness', round(("last_state"->>'brightness')::numeric * 100 / 254))
  WHERE jsonb_typeof("last_state"->'brightness') = 'number';--> statement-breakpoint
UPDATE "device_state" SET "state" = "state" || jsonb_build_object('brightness', round(("state"->>'brightness')::numeric * 100 / 254))
  WHERE jsonb_typeof("state"->'brightness') = 'number';--> statement-breakpoint
UPDATE "hardware" SET "last_state" = "last_state" || jsonb_build_object('color_temp', round(1000000 / ("last_state"->>'color_temp')::numeric))
  WHERE jsonb_typeof("last_state"->'color_temp') = 'number' AND ("last_state"->>'color_temp')::numeric > 0;--> statement-breakpoint
UPDATE "device_state" SET "state" = "state" || jsonb_build_object('color_temp', round(1000000 / ("state"->>'color_temp')::numeric))
  WHERE jsonb_typeof("state"->'color_temp') = 'number' AND ("state"->>'color_temp')::numeric > 0;--> statement-breakpoint
UPDATE "capabilities" SET "unit" = '%', "min" = 0, "max" = 100, "step" = NULL, "is_setting" = false,
  "native" = "native" || jsonb_build_object('max', coalesce("max", 254))
  WHERE "key" = 'brightness';--> statement-breakpoint
UPDATE "capabilities" SET "unit" = 'K',
  "min" = CASE WHEN "max" > 0 THEN round(1000000 / "max") ELSE 1000 END,
  "max" = CASE WHEN "min" > 0 THEN round(1000000 / "min") ELSE 10000 END,
  "step" = NULL, "is_setting" = false
  WHERE "key" = 'color_temp';--> statement-breakpoint
UPDATE "capabilities" SET "is_setting" = false WHERE "key" = 'state';
```

(In der `color_temp`-Zeile beziehen sich `"max"`/`"min"` rechts auf die alten Werte – in Postgres sieht `SET` immer die Zeile vor der Änderung; der Test belegt das.)

- [ ] **Step 9: Aggregat nach Migrationen.** `hourly-backfill.ts`: nach der bisherigen Logik (oder wenn sie „nothing to backfill“ ergibt) zusätzlich `call refresh_continuous_aggregate('measurements_hourly', NULL, '<to>')` mit `to` = letzte volle Stunde (wie bisher berechnet), umschlossen von einer Wiederholung bei Fehlern, deren Text `concurrent refresh` enthält (bis 50 Versuche, 100 ms Pause; anderer Fehler → weiterwerfen). Die Rückgabe bleibt `{ from, to } | null` für die bisherige Nachrechnung. Unit-/E2E-Fall in `measurements-hourly.e2e-spec.ts`: Messwert in einer schon materialisierten Stunde ändern (`update measurements …`), `backfillHourly(url)` → Aggregat zeigt den neuen Wert. FAIL → implementieren → grün; danach ist der Migrationstest aus Step 8 grün.

- [ ] **Step 10:** `attention.rules.ts`: `isTrue = (value: unknown): boolean => value === true;` (Spec 5.4), Test anpassen (`'ON'` zählt nicht mehr).

- [ ] **Step 11:** Komplett: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:tz && pnpm build` grün; zusätzlich `sh infra/compose/test/stack-test.sh` (Simulator-Ende-zu-Ende) grün. Commits nach Teilen getrennt, z. B. `refactor(backend): neutral gateway ingest behind the adapter contract`, `feat(backend): canonical lamp values and aggregate refresh after migrations`.

---

### Task 6: Gateway-Status je Adapter, Registrierung mit Art

**Files:**

- Modify: `apps/backend/src/core/gateways/gateway-status.consumer.ts` (+ spec), `gateway-status-memory.ts` (+ spec), `gateways.service.ts` (+ spec), `gateways.controller.ts` (nur falls nötig), `gateways.module.ts`, `apps/backend/test/gateway-status.e2e-spec.ts`, `apps/backend/test/gateways.e2e-spec.ts`

**Interfaces:**

- Consumes: Task 2 (`AdapterRegistry`), Task 3 (`serviceStatusTopic`, `parseServiceStatus`), Task 5 (Lebenszeichen kommt aus dem Ingest)
- Produces:
  - `StatusMemory.record(id, kind: 'bridge' | 'service', status, now, serviceKind?: GatewayKind)`; `RecalledStatus { bridge?; service?; serviceKind?: GatewayKind; at? }`
  - `GatewaysService.register(householdId, input)` nutzt `input.kind ?? 'z2m'`; unbekannte Art (kein Adapter in der Registry) → `ApiError(HttpStatus.BAD_REQUEST, 'validation.failed')`; Präfix `gw/<id>/<kind>`; übernimmt gemerkten Service-Status nur bei `serviceKind === kind`.

- [ ] **Step 1: Failing Tests Status-Consumer** (bestehende Spec umbauen, Fake-Registry mit zwei Fake-Adaptern `z2m` und `xx`, `serviceStatusTopic` `'bridge/state'` bzw. `'status'`):
  - abonniert `gw/+/bridge/connection`, `gw/+/z2m/bridge/state`, `gw/+/xx/status` – und **nicht** mehr `gw/+/z2m/#`
  - Service-Status wird mit dem Parser des jeweiligen Adapters gelesen und als `'service'` angewendet
  - Status unter `gw/<id>/xx/status` für ein als `z2m` registriertes Gateway → ignoriert (gedrosselt protokolliert); `applyStatus` prüft die Art (Repository bekommt den erwarteten `kind` als Parameter und wendet nur bei Übereinstimmung an – `where kind = $kind`)
  - nicht registriertes Gateway: Status landet mit `serviceKind` im Speicher
    → FAIL.

- [ ] **Step 2:** Implementieren. `GatewaysRepository.applyStatus(id, kind: GatewayStatusKind, status, now, serviceKind?: GatewayKind)` – bei `'service'` nur Zeilen mit passender Art. `onActivity` und `Z2M_LEVELS` entfernen. → grün.

- [ ] **Step 3: Failing Tests Registrierung** (`gateways.service.spec.ts`, `gateways.e2e-spec.ts`): ohne `kind` → `z2m` und Präfix `gw/<id>/z2m`; `kind: 'z2m'` explizit → gleich; Registry ohne Adapter für die Art (Test-Registry leer) → 400 `validation.failed`; gemerkter Service-Status anderer Art wird nicht übernommen. → FAIL → implementieren → grün.

- [ ] **Step 4:** `pnpm --filter @smart/backend test`, `pnpm lint && pnpm typecheck` grün. Commit `refactor(backend): gateway service status per adapter`.

---

### Task 7: Nachweis ohne Z2M – Test-Adapter durch die ganze Kette

**Files:**

- Create: `apps/backend/test/helpers/plain-adapter.ts`, `apps/backend/test/adapter-contract.e2e-spec.ts`

**Interfaces:**

- Consumes: alles aus Task 2–6
- Produces: nichts für Produktionscode.

- [ ] **Step 1:** `plain-adapter.ts`: `PlainAdapter implements GatewayAdapter` mit `kind = 'z2m'` (die Datenbank kennt nur diese Art), aber eigenem Format:
  - `serviceStatusTopic = 'service'`, Nutzlast `up`/`down`
  - `classify`: `inventory`, `node/<id>`, `node/<id>/reach` → `{ maxBytes: 65536 }`, sonst `undefined`
  - `inventory`: JSON `[{ id, title, caps: [{ key, kind, unit, read, write }] }]` → `hardware.listed` (`externalId = id`, `address = null`, `name = title`, Fähigkeiten mit `native: {}`)
  - `node/<id>`: JSON mit kanonischen Werten → `hardware.report` mit `{ externalId: id }`, `native` = Objekt, und `activity`
  - `node/<id>/reach`: `yes`/`no` → `hardware.availability` mit `{ externalId: id }`
  - `decodeReport(native)`: `{ values: native, measuredAt: undefined }` (Objekt) bzw. `{ values: {}, … }`

  Hinweis: `{ externalId }` bei Verfügbarkeit verlangt, dass `GatewayIngest.onAvailability` auch externe IDs auflöst (Task 5 hat `findByExternalId`); fehlt das, ist das ein Befund für Task 5 – dann dort nachziehen und im Ledger festhalten.

- [ ] **Step 2: Test** `adapter-contract.e2e-spec.ts` (Aufbau der App wie in `device-ingest.e2e-spec.ts`, aber `.overrideProvider(GATEWAY_ADAPTERS).useValue([new PlainAdapter()])`): Gateway registrieren, über den Test-Broker veröffentlichen:
  1. `gw/<id>/z2m/service` `up` → `GET gateways`: `serviceStatus: 'online'`
  2. `gw/<id>/z2m/inventory` mit einem Sensor (`soil_moisture` numeric `%` lesbar) → `GET hardware?state=unassigned` zeigt ihn mit `externalId`, `name`
  3. Gerät daraus anlegen (`POST devices`)
  4. `gw/<id>/z2m/node/<id>` `{"soil_moisture": 33}` → `GET devices/:id` zeigt `state.soil_moisture = 33`, Messwert in `measurements`, `last_message_at` gesetzt
  5. `gw/<id>/z2m/node/<id>/reach` `no` → Gerät `availability: 'offline'`
  6. Nachricht im Z2M-Format (`gw/<id>/z2m/bridge/devices`) → ändert nichts (der Test-Adapter klassifiziert sie nicht)
     Erst mit fehlendem Override laufen lassen und sehen, dass Schritt 1 scheitert (Z2M versteht `service` nicht) – dann mit Override grün.

- [ ] **Step 3:** Commit `test(backend): prove the core works with a non-z2m adapter`.

---

### Task 8: Frontend – Art im Gateway-Status, neutrale Werte

**Files:**

- Modify: `apps/frontend/src/app/features/gateways/gateways-page.ts`, `apps/frontend/src/app/features/gateways/i18n/de.json`, `en.json`, `gateway-block.*` falls derselbe Text dort steht, Specs; `apps/frontend/src/app/features/devices/device-values.ts` (+ spec)

**Interfaces:**

- Consumes: Task 1 (`gateway.kind`, `serviceStatus`)

- [ ] **Step 1: Failing Spec** (`gateways-page.spec.ts`): Ein Gateway mit `kind: 'z2m'`, `bridgeStatus: 'online'`, `serviceStatus: 'offline'` zeigt „Bridge: Online · Zigbee2MQTT: Offline“ (de). → FAIL, solange der Text fest „Zigbee2MQTT“ enthält, wird der Test so formuliert, dass er den Schlüssel `gateways.kind.z2m` verlangt (Transloco-Testing mit den echten de-Übersetzungen, wie die vorhandenen Specs es tun).

- [ ] **Step 2:** i18n: `"kind": { "z2m": "Zigbee2MQTT" }` (de und en), `"entry.status": "Bridge: {{ bridge }} · {{ kind }}: {{ service }}"`; Template: `kind: ('gateways.kind.' + gateway.kind | transloco)` – Schlüssel über eine Hilfsfunktion `kindKey(kind)` mit `marker()`-Map, damit `pnpm i18n:check` sie findet (Muster wie `statusKey`). → grün; `pnpm i18n:check` grün.

- [ ] **Step 3: `device-values.ts`:** `'ON'`/`'OFF'`-Zweige entfernen (Werte sind jetzt Booleans), Spec-Fälle mit `'ON'` auf `true` umstellen. Prüfen, dass Einheiten `%` und `K` so angezeigt werden wie andere Einheiten (vorhandene Formatierung, ggf. Spec-Fall `color_temp: 2700` mit Einheit `K` → „2.700 K“ bzw. nach der vorhandenen Zahlformatierung).

- [ ] **Step 4:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` (Bundle-Grenze), Storybook-Tests nur, falls Stories betroffen sind (`pnpm --filter @smart/frontend storybook:test` o. Ä. laut `package.json`). Commit `feat(frontend): name the gateway kind in its status`.

---

### Task 9: Dokumentation

**Files:**

- Create: `docs/adr/0021-gateway-adapters-in-backend.md` (Muster `0000-template.md`), Eintrag in `docs/adr/README.md`
- Modify: `docs/superpowers/specs/2026-10-11-smart-home-architecture-design.md` (Nachträge in 4.4, 8.4, 8.5, 8.6, 13, 14), `CLAUDE.md` (Architekturregeln: Adapter-Zeile), `docs/architecture/overview.md` (falls dort Gateway-Arten erwähnt), `docs/runbooks/gateway.md` nur falls Spalten-/Feldnamen dort vorkommen (`git grep -n "z2m_status\|friendly_name\|ieee_address\|interview_state" docs`)

- [ ] **Step 1:** ADR-0021 „Gateway-Adapter im Backend“: Kontext (weitere Systeme, HA), Entscheidung (Adapter im Backend, Teile zuhause leiten weiter; Vokabular; zustandslose Adapter; `native`), Konsequenzen (neue Elementart, Broker-ACL je Art, Befehle über `encodeCommand` ab 6c-3), Details-Verweis auf die Spec.
- [ ] **Step 2:** Architektur-Spec: kurze „Nachtrag Adapter-Schicht (2026-11-18)“-Absätze an den genannten Stellen (Tabellenzeilen von `gateways`/`hardware`/`capabilities` aktualisieren; 8.5 verweist für das Topic-Verständnis auf den Z2M-Adapter; 8.6: Adresse statt IEEE-Adresse im Set-Topic, Werte kanonisch, `encodeCommand`).
- [ ] **Step 3:** `CLAUDE.md`, Architekturregeln, Backend-Zeile: „Backend: `platform/` → nichts Fachliches; `core/*` → nie `modules/*` oder `adapters/*`; Module und Gateway-Adapter (`src/adapters/<kind>`, einer je Gateway-Art, registriert in `app.module.ts`) nie untereinander; fremde Elemente nur über deren `index.ts`.“ und ein Satz: „Fähigkeiten heißen nach dem Vokabular in `@smart/contracts` (`vocabulary.ts`); Adapter rechnen in dessen Einheiten um.“
- [ ] **Step 4:** `pnpm format:check` (Prettier für Markdown) grün; Commit `docs(docs): adapter layer in architecture, ADR-0021 and CLAUDE.md`.

---

## Abschluss

- Gesamtprüfung: `pnpm install --frozen-lockfile && pnpm format:check && pnpm lint && pnpm licenses:check && pnpm typecheck && pnpm test && pnpm test:tz && pnpm build`, `sh infra/compose/test/stack-test.sh`.
- `git grep -nE -f /Users/tillkosiol/Projekte/smart/.local/private-patterns.txt -- .` ohne Treffer.
- PR „feat: gateway adapter layer (Zigbee2MQTT as first adapter)“ mit Zusammenfassung, Liste der Entscheidungen (Spec 11) und Hinweis auf die Migrationen 0010/0011.
