# Etappe 6c-2: Live-Aktualisierung – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Werte, Hinweise, Gateway-Status, neu erkannte Hardware und Verlauf aktualisieren sich per SSE ohne Neuladen und ohne Polling.

**Architecture:** `@smart/contracts` beschreibt die Live-Ereignisse. Die Core-Module `devices`, `gateways`, `attention` und `identity` bekommen die fehlenden internen Ereignisse und Abfragen; das neue Modul `core/live` hält die Streams (`LiveHub`), baut aus internen Ereignissen gedrosselt die DTOs (`LivePublisher`) und liefert `GET …/events` (`LiveController`). Im Frontend öffnet `core/live` den Stream per `fetch`, verteilt die Ereignisse an Abonnenten (`injectLive`) und ruft nach jedem Verbinden `resync`; die Features ersetzen damit ihr Polling.

**Tech Stack:** NestJS (Express, `@Res()`), Node `EventEmitter`, Drizzle, zod/mini, Angular 22 (zoneless, Signals), Vitest, Testcontainers, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-27-etappe-6c2-live-design.md`

**Planform:** schlank wie 6b/6c-1. Exakte Schnittstellen dort, wo Tasks voneinander abhängen; Verhalten und Tests als Anforderung.

**Freigabe und Ausführung:** Till hat Spec und Umsetzung am 2026-10-27 freigegeben („schreib den plan und setze um“), ohne Zwischenreview; Meldung erst, wenn der PR bereit zum Merge ist. Subagent-gestützt: Implementierung und Task-Reviews Sonnet, Gesamt-Review Opus.

## Global Constraints

- Gate je Task: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:tz && pnpm build`; Backend-Tasks zusätzlich `pnpm --filter @smart/backend test` (Docker, OpenSSL ≥ 3).
- Nach Änderungen an `@smart/contracts`: `pnpm packages:build`.
- Keine KI-Attribution in Commits/PR; Conventional Commits mit Scope (`contracts`, `backend`, `frontend`, `docs`); Body-Zeilen ≤ 100 Zeichen. Öffentliches Repo: keine privaten Daten.
- Backend-Architektur: `core/*` importiert andere Core-Module nur über deren `index.ts`; kein Core-Modul außer `core/live` kennt `core/live`. Regeln nie abschalten.
- Frontend-Architektur: `core/` importiert nie Features; `core/` nur `@smart/ui/shell`; kein sichtbarer Text ohne Übersetzungsschlüssel; keine Komponenten-Styles außerhalb `@smart/ui`.
- Initiales Bundle ≤ 425 kB (Stand 413,24 kB); nach Frontend-Tasks `pnpm build` und Wert im Commit-Body. Keine `resource()`/`httpResource()`.
- Zeit: übertragen nur UTC (`…Z`).
- Ereignisse (Spec 2): `device.state` → `Device` ab `viewer`; `gateway.status` → `Gateway` nur `owner`; `hardware.updated` → `Hardware` nur `owner`; `hardware.removed` → `{ id }` nur `owner`; `attention.changed` → `AttentionList` ab `viewer`, gefiltert wie `GET attention`.
- Drosselung: je Schlüssel höchstens ein Ereignis pro Sekunde (sofort beim ersten Auslöser, danach höchstens eins am Ende der Sekunde mit dem dann aktuellen Stand). Heartbeat `: ping` alle 25 s.
- Client: Backoff 1 s, 2 s, 4 s … höchstens 30 s, ±20 % Zufall; nach erfolgreichem Verbinden wieder 1 s.

## Review Focus

1. **Rechte im Stream:** Ein Betrachter bekommt nie `gateway.status`, `hardware.*` oder `cert_expiring`; wer während des Streams aus dem Haushalt fliegt, bekommt nach dem nächsten Heartbeat nichts mehr. → Tests in Task 4 (Hub) und Task 5 (Integration).
2. **Stream bricht still ab** (Proxy-Timeout nach 1 h, WLAN-Wechsel, Server-Neustart): die App verbindet neu und lädt per `resync`, ohne Meldung und ohne doppelte Verbindung. → Tests in Task 6.
3. **Ereignis kommt vor der ersten Ladung oder während einer Ladung:** `upsert` auf eine nicht geladene Liste ändert nichts, und eine spätere REST-Antwort überschreibt kein neueres Ereignis auf der Geräteseite. → Tests in Task 7.
4. **Viele Meldungen** (Steckdose mit Strommessung alle 2 s, Bridge-Liste mit 50 Geräten nach Z2M-Neustart): höchstens ein Ereignis je Objekt und Sekunde, keine Anfrage-Lawine im Verlauf. → Tests in Task 5 (Publisher) und Task 8 (Verlauf).
5. **Abmelden oder Session abgelaufen bei offenem Tab:** 401 geht an den Unauthorized-Handler, kein Dauer-Neuverbinden; nach erneuter Anmeldung läuft der Stream wieder. → Test in Task 6.

---

### Task 1: Contracts – Live-Ereignisse (Sonnet)

**Files:** Create `packages/contracts/src/live.ts`, `live.spec.ts`; Modify `packages/contracts/src/index.ts`.

**Interfaces – Produces:**

```ts
export const LIVE_EVENT_TYPES = [
  'device.state',
  'gateway.status',
  'hardware.updated',
  'hardware.removed',
  'attention.changed',
] as const;
export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];
/** Discriminated union over `type`; `data` uses deviceSchema, gatewaySchema, hardwareSchema,
 * z.object({ id: z.string() }), attentionListSchema. */
export const liveEventSchema;
export type LiveEvent = z.infer<typeof liveEventSchema>;
export type LiveEventData<T extends LiveEventType> = Extract<LiveEvent, { type: T }>['data'];
```

- [ ] Tests zuerst: jedes der fünf Ereignisse mit gültigen Daten wird angenommen; unbekannter `type`, `device.state` mit Hardware-Daten und `hardware.removed` ohne `id` werden abgelehnt; `LIVE_EVENT_TYPES` deckt alle Zweige ab.
- [ ] Umsetzung mit `zod/mini` (`z.discriminatedUnion`), `pnpm packages:build`, Gate, Commit `feat(contracts): describe live events`.

### Task 2: Backend – Ereignisse für Geräte und Hardware (Sonnet)

**Files:** Modify `apps/backend/src/core/devices/device-events.ts`, `device-message.handler.ts`, `device-ingest.consumer.ts`, `devices.service.ts`, `devices.repository.ts`, `hardware.repository.ts`, `index.ts`, Attention-Aufrufer von `DeviceStateChanged` falls nötig; Tests in den vorhandenen `*.spec.ts` und `apps/backend/test/hardware-ingest.e2e-spec.ts`, `device-ingest.e2e-spec.ts`, `devices-api.e2e-spec.ts`.

**Interfaces – Produces (über `core/devices/index.ts`):**

```ts
export interface DeviceStateChanged { householdId: string; deviceId: string } // householdId neu
export const DEVICE_CHANGED = 'device.changed';
export interface DeviceChanged { householdId: string; deviceId: string }
export const HARDWARE_CHANGED = 'hardware.changed';
export interface HardwareChanged { hardwareId: string }
// HardwareRepository
/** undefined: hardware or its gateway unknown. listed: null when the hardware is not in the
 * household's "new hardware" list (removed, bound to a device, gateway revoked). */
listingOf(hardwareId: string): Promise<{ householdId: string; listed: HardwareWithCapabilities | null } | undefined>;
// exportiert: toDevice, toHardware (aus devices.service.ts)
```

- `DEVICE_CHANGED` geht über `DeviceEvents` bei: neuem Zustand (dort, wo `DEVICE_STATE_CHANGED` entsteht, zusätzlich), Verfügbarkeit (die Geräte auf der Hardware; `setAvailability` liefert dafür `{ deviceId, householdId }[]` der betroffenen Geräte zurück), `create` (nach dem Anlegen) und jedem erfolgreichen `update` (Name, Symbol, Schwellwerte).
- `DEVICE_STATE_CHANGED` bekommt die `householdId` (`activeBindingForHardware` liefert sie per Join mit `devices` mit); Bedeutung für `core/attention` bleibt.
- `HARDWARE_CHANGED` geht über `DeviceEvents` bei: jeder Hardware aus `upsertFromBridge` (Rückgabe erweitert um `ids: string[]` = eingefügte/aktualisierte und neu entfernte), nachgeholter Verfügbarkeit, `device_joined`, `device_interview` (`setInterviewState` liefert die ID oder `undefined`), `device_leave`, `device_renamed`, Verfügbarkeit, Zustand freier Hardware (im Message-Handler, wenn `recordState` geschrieben hat und es keine Bindung gibt) und `DevicesService.create` (die Hardware ist jetzt zugeordnet).
- Ereignisse erst nach dem erfolgreichen Schreiben; nie, wenn nichts geschrieben wurde. Listener-Fehler dürfen den Ingest nicht stören (Node-`emit` ruft synchron; die Listener in Task 3/5 fangen selbst – hier nichts weiter nötig).
- [ ] Tests zuerst: Unit-Specs des Message-Handlers (State-Changed mit `householdId`; `DEVICE_CHANGED` nur bei `updated`; `HARDWARE_CHANGED` für freie Hardware nur bei geschriebenem Zustand) und des Service (`create` meldet Gerät und Hardware, `update` meldet das Gerät). E2E: Bridge-Liste, Join, Interview, Leave, Rename, Verfügbarkeit melden je die Hardware-ID; Verfügbarkeit einer zugeordneten Hardware meldet zusätzlich das Gerät mit Haushalt; `listingOf` liefert freie Hardware, `listed: null` für zugeordnete, entfernte und Hardware widerrufener Gateways, `undefined` für unbekannte ID.
- [ ] Umsetzung, Gate inkl. Backend-Tests, Commit `feat(backend): announce device and hardware changes`.

### Task 3: Backend – Gateways, Hinweise, Sessions (Sonnet)

**Files:** Modify `apps/backend/src/core/gateways/gateway-events.ts`, `gateway-status.consumer.ts`, `gateways.service.ts`, `gateways.repository.ts`, `index.ts`; `core/attention/attention.service.ts`, `attention.module.ts`, `index.ts`, Create `core/attention/attention-events.ts`; `core/identity/session.service.ts`, `sessions.repository.ts`; Tests in den vorhandenen Specs und `apps/backend/test/gateway-status.e2e-spec.ts`, `attention.e2e-spec.ts`, `identity-sessions.e2e-spec.ts`.

**Interfaces – Produces:**

```ts
// core/gateways
export const GATEWAY_TOUCHED = 'gateway.touched';
export interface GatewayTouched { gatewayId: string }
// GatewaysService
find(gatewayId: string): Promise<{ householdId: string; gateway: Gateway } | undefined>; // auch widerrufene
// core/attention
export const ATTENTION_CHANGED = 'attention.changed';
export interface AttentionChanged { householdId: string }
export class AttentionEvents extends EventEmitter {} // Provider in AttentionModule, exportiert
// core/identity – SessionService
/** Whether the session is neither revoked nor expired (idle or absolute); does not extend it. */
isActive(sessionId: string): Promise<boolean>;
```

- `GATEWAY_TOUCHED` nach einem erfolgreichen `touch` in `gateway-status.consumer.ts` (dort ist er schon auf einmal pro Minute gedrosselt).
- `AttentionService.apply` vergleicht die neue Liste mit der vorherigen (`JSON.stringify` der ungefilterten `items`); nur bei Unterschied `ATTENTION_CHANGED`. Auch wenn ein Haushalt leer wird und vorher Hinweise hatte. `emit` in `try/catch`, ein Listener-Fehler wird protokolliert und stört die Berechnung nicht.
- [ ] Tests zuerst: Consumer meldet `GATEWAY_TOUCHED` nur nach erfolgreichem `touch`; `find` liefert Gateway mit Haushalt, `undefined` für unbekannte ID; Attention meldet bei neuer Liste, nicht bei gleicher (zweiter Tick ohne Änderung), bei geleertem Haushalt einmal; `isActive` false für widerrufene, abgelaufene (idle und absolut) und unbekannte Session, true für gültige, ohne `last_seen_at` zu ändern.
- [ ] Umsetzung, Gate inkl. Backend-Tests, Commit `feat(backend): announce gateway activity and attention changes`.

### Task 4: Backend – `core/live`: Hub und Format (Sonnet)

**Files:** Create `apps/backend/src/core/live/sse.ts`, `live-hub.ts`, `live-hub.spec.ts`, `sse.spec.ts`, `live.options.ts`, `index.ts`.

**Interfaces – Produces:**

```ts
// sse.ts
export const SSE_CONNECTED = ': connected\n\n';
export const SSE_PING = ': ping\n\n';
export function sseEvent(type: LiveEventType, data: unknown): string; // `event: …\ndata: <JSON>\n\n`
// live.options.ts
export interface LiveOptions {
  heartbeatMs: number;
  throttleMs: number;
}
export const LIVE_OPTIONS: InjectionToken; // Standard { heartbeatMs: 25_000, throttleMs: 1000 }
// live-hub.ts
export interface Audience {
  role: HouseholdRole;
  isPlatformAdmin: boolean;
}
export interface LiveClient {
  householdId: string;
  userId: string;
  sessionId: string;
  audience: Audience;
  /** Writes to the response; false when its buffer is full. */
  write(chunk: string): boolean;
  /** Ends the response; called at most once by the hub. */
  close(): void;
}
@Injectable()
export class LiveHub implements OnModuleInit, OnModuleDestroy {
  add(client: LiveClient): () => void; // gibt das Abmelden zurück
  watching(householdId: string): boolean;
  publish(householdId: string, type: LiveEventType, data: unknown, minRole: HouseholdRole): void;
  /** Builds once per distinct audience among the household's clients. */
  publishByAudience(
    householdId: string,
    type: LiveEventType,
    build: (audience: Audience) => unknown,
  ): void;
  /** Pings every client and checks session and membership (also run by the timer). */
  heartbeat(): Promise<void>;
}
```

- Abhängigkeiten des Hubs: `SessionService.isActive`, `MembershipsRepository.find`, `UsersRepository.findById` (für `isPlatformAdmin`), `LIVE_OPTIONS`.
- `heartbeat`: schreibt `SSE_PING`; schließt Clients mit inaktiver Session oder ohne Mitgliedschaft; aktualisiert `audience` aus Mitgliedschaft und Nutzer. Ein Fehler bei der Prüfung (DB weg) schließt nicht, sondern wird protokolliert (nächster Heartbeat prüft erneut).
- `write` liefert `false` → Client sofort schließen und entfernen.
- `onModuleDestroy`: Timer stoppen, alle Clients schließen.
- [ ] Tests zuerst (Unit mit Fakes): `sseEvent`-Format inkl. Daten mit Zeilenumbruch im String (bleibt eine `data:`-Zeile); Verteilen nach `minRole` (viewer/member/owner); `publishByAudience` baut je Audience einmal und filtert so `cert_expiring`; fremder Haushalt bekommt nichts; Heartbeat schreibt Ping, schließt bei inaktiver Session und bei entfernter Mitgliedschaft, übernimmt geänderte Rolle; voller Puffer schließt; `onModuleDestroy` schließt alle; Abmelden entfernt und `watching` wird false.
- [ ] Umsetzung, Gate, Commit `feat(backend): hold live streams per household`.

### Task 5: Backend – Publisher, Controller, Modul (Sonnet)

**Files:** Create `apps/backend/src/core/live/coalescer.ts`, `coalescer.spec.ts`, `live-publisher.ts`, `live-publisher.spec.ts`, `live.controller.ts`, `live.module.ts`; Modify `core/live/index.ts`, `apps/backend/src/app.module.ts`, ggf. `tools/lint-config` nur falls die Grenzregeln `core/live` nicht kennen (Regel mit Test anpassen, nie abschalten); Test `apps/backend/test/live.e2e-spec.ts`.

**Interfaces – Consumes:** Task 1 (`LiveEventType`), Task 2 (`DEVICE_CHANGED`, `HARDWARE_CHANGED`, `listingOf`, `toDevice`, `toHardware`, `DevicesRepository.get`), Task 3 (`GATEWAY_STATUS_CHANGED|REGISTERED|REVOKED|TOUCHED`, `GatewaysService.find`, `ATTENTION_CHANGED`, `AttentionEvents`, `AttentionService.list`), Task 4 (`LiveHub`, `LIVE_OPTIONS`, `sse.ts`).

**Interfaces – Produces:**

```ts
export class Coalescer {
  constructor(windowMs: number, onError: (error: unknown) => void);
  /** Runs now when the key is quiet; otherwise once at the end of the window (latest call wins). */
  schedule(key: string, run: () => Promise<void>): void;
  dispose(): void;
}
```

- Publisher-Zuordnung (Schlüssel → Ereignis):
  - `device:<id>` → `DevicesRepository.get(householdId, id)` → `toDevice` → `publish(…, 'device.state', …, 'viewer')`; nur wenn `hub.watching(householdId)`; Gerät weg → nichts.
  - `hardware:<id>` → `listingOf(id)`; `undefined` → nichts; `listed` → `hardware.updated` (`toHardware`), sonst `hardware.removed { id }`; beide `owner`.
  - `gateway:<id>` (Status, registriert, widerrufen, touched) → `GatewaysService.find` → `gateway.status`, `owner`.
  - `attention:<householdId>` → `publishByAudience(householdId, 'attention.changed', (a) => ({ items: attention.list(householdId, a.role, a.isPlatformAdmin) }))`; nur wenn `watching`.
  - Fehler beim Bauen: protokollieren (ohne Daten), Ereignis verwerfen.
- Controller: `@Controller('v1/households/:householdId')`, `@UseGuards(HouseholdGuard)`, `@Get('events') @RequireRole('viewer')`, `@Req()` + `@Res()`. Header `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`; `flushHeaders()`, `SSE_CONNECTED` schreiben, beim Hub anmelden; `close` des Requests meldet ab. `audience` aus `membershipOf(request).role` und `UsersRepository.findById(...).isPlatformAdmin`.
- `LiveModule` importiert `DevicesModule`, `GatewaysModule`, `AttentionModule`, `HouseholdsModule`, `IdentityModule`; in `AppModule` registriert.
- [ ] Tests zuerst: Coalescer (sofort beim ersten Aufruf; drei Aufrufe im Fenster → genau ein weiterer Lauf am Fensterende mit dem letzten `run`; Fehler gehen an `onError`, das Fenster läuft weiter; `dispose` verwirft Ausstehendes). Publisher (Unit mit Fakes): je Quelle das richtige Ereignis und die richtige Rolle; 10 `DEVICE_CHANGED` in 200 ms → zwei Builds; ohne Zuschauer kein Build; Fehler beim Bauen verwirft nur dieses Ereignis. E2E (`live.e2e-spec.ts`, echter HTTP-Stream mit `LIVE_OPTIONS` `{ heartbeatMs: 200, throttleMs: 50 }`): Header und `: connected`; Messwert per MQTT → `device.state` beim Betrachter mit neuem Wert; `gateway.status` beim Besitzer, nicht beim Betrachter; Mitgliedschaft löschen → Stream endet nach dem Heartbeat; ohne Session 401, fremder Nutzer 404; App-Shutdown beendet offene Streams.
- [ ] Umsetzung, Gate inkl. Backend-Tests, Commit `feat(backend): stream live events per household`.

### Task 6: Frontend – `core/live` (Sonnet)

**Files:** Create `apps/frontend/src/app/core/live/sse-parser.ts`, `sse-parser.spec.ts`, `live.service.ts`, `live.service.spec.ts`, `throttled.ts`, `throttled.spec.ts`, `index.ts`.

**Interfaces – Produces:**

```ts
export interface SseMessage {
  event: string;
  data: string;
}
export class SseParser {
  push(chunk: string): SseMessage[];
}
export type LiveHandlers = { [T in LiveEventType]?: (data: LiveEventData<T>) => void } & {
  /** After every connect while subscribed: load the shown state again (REST). */
  resync?: () => void;
};
@Injectable({ providedIn: 'root' })
export class LiveService {
  subscribe(handlers: LiveHandlers): () => void;
}
/** Subscribes for the injection context's lifetime. */
export function injectLive(handlers: LiveHandlers): void;
/** Runs `run` now when quiet, else once at the end of the window; `dispose` drops what is due. */
export function throttled(windowMs: number, run: () => void): { trigger(): void; dispose(): void };
export const LIVE_RETRY = { firstMs: 1000, maxMs: 30_000, jitter: 0.2 } as const;
```

- Verbindung nur, wenn `AuthService.status() === 'signedIn'`, ein Haushalt gewählt ist (`HouseholdContext.current()?.id`), mindestens ein Abonnent da ist und `document.visibilityState === 'visible'`. Ändert sich eine Bedingung, wird geschlossen bzw. (neu) verbunden; Haushaltswechsel schließt und verbindet mit dem neuen. Nie zwei Verbindungen gleichzeitig.
- `fetch` über `API_FETCH` (`GET /api/v1/households/:id/events`, `credentials: 'same-origin'`, Header `Accept: text/event-stream`, `ngsw-bypass: true`, `AbortController`). Lesen mit `response.body.getReader()` + `TextDecoder` (`stream: true`), Nachrichten aus `SseParser`; `data` per `JSON.parse`, unbekannte Ereignistypen und kaputtes JSON ignorieren.
- Antwort `ok` mit `text/event-stream` → verbunden: Backoff zurücksetzen, `resync` aller aktuellen Abonnenten. Abonnenten, die bei offenem Stream dazukommen, bekommen kein `resync`.
- 401 (Code `auth.required`) → `UNAUTHORIZED_HANDLER`, kein neuer Versuch bis sich Anmeldung oder Haushalt ändert. 403/404 → kein neuer Versuch bis zum Haushaltswechsel. Sonst (Netzfehler, 5xx, falscher Content-Type, Stream-Ende) → neu verbinden nach `LIVE_RETRY`.
- Ein Handler, der wirft, stört weder andere Handler noch den Stream.
- `SseParser`: Zeilenenden `\n`, `\r\n`, `\r`; Kommentare (`:`); `event`/`data` (mehrere `data`-Zeilen mit `\n` verbunden); Feld ohne Doppelpunkt; ein Leerzeichen nach dem Doppelpunkt entfernen; Nachricht ohne `data` verwerfen; Typ ohne `event` = `message`; Chunks an beliebiger Stelle (auch mitten in `\r\n`).
- [ ] Tests zuerst: Parser-Fälle oben; Service mit fake `API_FETCH` (steuerbarer `ReadableStream`) und Fake-Timern: verbindet erst mit Abonnent, schließt beim letzten Abmelden, schließt bei unsichtbarem Tab und verbindet beim Sichtbarwerden mit `resync`; Haushaltswechsel; Backoff-Folge 1/2/4/…/30 s mit Grenze (Zufall per `vi.spyOn(Math, 'random')`), Rücksetzen nach Erfolg; 401 ruft den Handler einmal und verbindet nicht weiter, nach erneuter Anmeldung schon (Review Focus 5); 403/404 ohne weiteren Versuch; Stream-Ende verbindet neu und ruft `resync` (Review Focus 2); werfender Handler; `throttled` (sofort, ein Nachlauf, `dispose`).
- [ ] Umsetzung, `pnpm build` (Bundle-Wert in den Commit-Body), Gate, Commit `feat(frontend): receive live events`.

### Task 7: Frontend – Listen und Seiten live (Sonnet)

**Files:** Modify `apps/frontend/src/app/core/household/loaded-list.ts` (+ Spec), `features/devices/device-list.ts`, `features/devices/device-page.ts`, `features/devices/new-hardware.ts`, `features/attention/attention.ts`, `features/gateways/gateway-block.ts`, `features/gateways/gateways-page.ts` und deren Specs.

**Interfaces – Consumes:** Task 6 (`injectLive`). **Produces:**

```ts
// LoadedList<T>
/** Replaces the entry with the same `id`, else appends; does nothing until the list is loaded. */
upsert(item: T & { readonly id: string }): void;
/** Drops the entry with that `id`; does nothing until the list is loaded. */
remove(id: string): void;
/** Sets the whole list as the server's answer (`loaded` true); answers still on their way are ignored. */
replace(items: readonly T[]): void;
```

- Je Stelle `injectLive` mit Handler und `resync` (Laden mit `keep = true` über den vorhandenen `RefreshGuard`, damit Netzfehler still bleiben); `refreshWhileVisible` (samt `REFRESH_MS`) wird entfernt; es wird sonst nirgends verwendet, die Mitgliederseite hat nie gepollt.
  - Geräteliste: `device.state` → `upsert`.
  - Geräteseite: `device.state` mit eigener ID → vorhandenes `updated(device)` (verwirft späte REST-Antworten; der getippte Name bleibt).
  - Neu erkannt: `hardware.updated` → `upsert`, `hardware.removed` → `remove` und den getippten Namen und Fehlerzustand dieser ID verwerfen.
  - Hinweise: `attention.changed` → Liste ersetzen (`replace`); Ruhezeile: `device.state` setzt `lastSeenAt` der Zusammenfassung auf das neuere von beiden.
  - Gateway-Block und Gateway-Seite: `gateway.status` → `upsert`.
- [ ] Tests zuerst: `upsert`/`remove`/`replace` (inkl. „nicht geladen → nichts“, Review Focus 3); je Stelle ein Spec mit einem Fake-`LiveService` (Provider in den Specs), dass das Ereignis die Anzeige ändert und `resync` neu lädt; Geräteseite: REST-Antwort nach einem Ereignis überschreibt es nicht; kein Intervall-Laden mehr (Fake-Timer 60 s → keine Anfrage).
- [ ] Umsetzung, `pnpm build` (Bundle-Wert im Commit-Body), Gate, Commit `feat(frontend): update lists and pages live`.

### Task 8: Frontend – Verlauf live (Sonnet)

**Files:** Modify `apps/frontend/src/app/features/devices/history-card.ts`, `history-card.spec.ts`.

**Interfaces – Consumes:** Task 6 (`injectLive`, `throttled`).

- `device.state` mit der ID des Geräts → `throttled(60_000, reload)` (leise Ladung wie bisher die 5-Minuten-Aktualisierung, also ohne Skeleton); `resync` → leise Ladung. `HISTORY_REFRESH_MS` und `refreshWhileVisible` entfallen; `throttled` wird beim Zerstören verworfen.
- [ ] Tests zuerst: Ereignis fremder ID lädt nicht; fünf Ereignisse in 10 s → eine Ladung sofort und eine nach Ablauf der Minute (Review Focus 4); `resync` lädt; kein Laden nach dem Zerstören.
- [ ] Umsetzung, Gate, Commit `feat(frontend): grow the history live`.

### Task 9: Stack-E2E und Doku (Sonnet)

**Files:** Modify `tests/e2e/specs/devices.spec.ts` (oder eigene Spec mit eigenem Haushalt nach `tests/e2e/helpers/accounts.ts`; Regeln aus `CLAUDE.md` zum Stack-Test beachten); `docs/superpowers/specs/2026-10-11-smart-home-architecture-design.md` (8.7 Nachtrag), `docs/adr/0010-sse-for-live-updates.md` (Nachtrag), `docs/superpowers/specs/2026-10-15-designkonzept-design.md` (Satz „Bis zur SSE-Anbindung …“), `CLAUDE.md` (Bundle-Stand).

- E2E: Geräteseite eines Simulator-Sensors öffnen, ohne Neuladen ändert sich ein angezeigter Messwert innerhalb von 30 s (Simulator meldet alle 5 s); dabei keine weitere `GET …/devices/:id`-Anfrage (Playwright `page.on('request')`). Ein Merkmal wählen, das sich bei jeder Meldung sicher ändert (vorher im Simulator nachsehen, ob Werte wiederholt werden können).
- Doku nach Spec Abschnitt 6.
- [ ] `sh infra/compose/test/stack-test.sh` grün, Gate, Commit `test(frontend): see values change live` und `docs(docs): describe live updates`.
