# Etappe 6b: Designsprache – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die App sieht aus wie Richtung B · Expressive: Status-Hero mit echten Hinweisen aus dem Backend, Geräte-Pods in Farben je Geräteart, „Alle Hinweise“, eine anpassbare Übersicht, Schwellen je Geräteart mit Anpassung je Gerät, und alle bestehenden Seiten in der neuen Sprache.

**Architecture:** `@smart/contracts` bekommt Geräteart, Schwellen, Hinweise und Übersichts-Layout als Schemas und reine Funktionen. Das Backend berechnet Hinweise im neuen Core-Modul `core/attention` (im Speicher, Uhr-gesteuert) und speichert Schwellen je Gerät und das Layout je Mitgliedschaft. `@smart/ui` bekommt Tokens und Bausteine; die Features nutzen nur diese (kein Feature-CSS).

**Tech Stack:** wie 6a (Angular 22 zoneless, Angular Material M3, NestJS 12, Drizzle, TimescaleDB, zod/mini, Vitest, Storybook mit axe, Playwright).

**Spec:** `docs/superpowers/specs/2026-10-15-designkonzept-design.md` (Abschnitte 2–8, Zeile 6b in 9). Bezug: Architektur-Spec Abschnitt 10, Spec 6a.

**Planform:** schlank wie 5b. Exakte Schnittstellen dort, wo Tasks voneinander abhängen (Contracts, API); Verhalten und Tests sonst als Anforderung.

**Wer setzt um (Tills Vorgabe):** Tasks mit sichtbarer Oberfläche (6–10): Fable macht das Visuelle; ab Task 8 baut zuerst Sonnet Logik, Gerüst und Tests, dann setzt Fable die Gestaltung darauf und macht ein kurzes Design-Review auf Screenshots (Änderung Till, 2026-10-15). Contracts, Backend und Theme (1–5) übernehmen Sonnet-Subagenten, kleine Nachprüfungen Haiku, das Gesamt-Review Opus. Die Mockups auf dem Design-Canvas (privat, bei Till) sind die Vorlage. Die Fable-Tasks bekommen die Dateien unter `<scratchpad>/design-canvas/project/` als Referenz (B-Uebersicht, B-Dunkel, B-Detail, B-Anpassen, B-Status-*).

**Bewusste Entscheidungen:**

- **Lampen-Pod als Schalter:** `ui-device-pod` kann in 6b schon schalten (Baustein, Story, Tests), die App nutzt in 6b nur den Link-Modus; Befehle kommen mit 6c.
- **Ohne SSE:** Übersicht und „Alle Hinweise“ laden beim Öffnen und alle 60 s, solange sichtbar (6a-Muster). `attention.changed` kommt mit 6c.
- **Warnfarbe:** Der Spike (Task 1) setzt den neuen Ton nur, wenn alle messbaren Kriterien bestehen. Die Sichtprüfung „ohne Legende unterscheidbar“ macht Till am PR in Storybook; fällt sie durch, wird Task 1 zurückgenommen.

## Global Constraints

- Alle Global Constraints aus 6a gelten weiter: Gate je Task (`pnpm lint && pnpm typecheck && pnpm test && pnpm test:tz && pnpm build`), keine KI-Attribution, öffentliches Repo ohne private Daten, Conventional Commits mit Scope, Commit-Body-Zeilen ≤ 100 Zeichen.
- UI-Regeln aus `CLAUDE.md`: kein `@angular/material`/`@angular/cdk` außerhalb von `@smart/ui`; kein Feature-CSS; in `@smart/ui` nur Tokens (keine Hex-Farben, keine px außerhalb `tokens/`); kein sichtbarer Text ohne Übersetzungsschlüssel (`pnpm i18n:check`); keine `DatePipe`.
- Initiales Bundle höchstens **480 kB** (Stand rund 472,7 kB): neue Bausteine nur in `public-api.ts`/`forms.ts`, nie in `shell.ts`; Bottom Sheet und Drag-Drop lazy. Nach jedem UI-Task `pnpm build` und die Zahl im Task-Bericht nennen.
- Farbe nur über Rollen (`--mat-sys-*`) und `--smart-*`-Tokens; jede neue Darstellung in Storybook **hell und dunkel mit der Standard-Grundfarbe** und axe ohne Verstöße (Änderung Till, 2026-10-15: keine Matrix über Kontraststufen und Grundfarben; die Tasks 6 und 7 wurden noch mit der 12er-Matrix gebaut).
- Formen: Karten `--mat-sys-corner-extra-large`, Pods und Einträge `--mat-sys-corner-large`, Chips/Pillen/Schalter `--mat-sys-corner-full`. Pods 140 × 116 px (`--smart-size-pod-width`/`-height`). Hauptwert `--smart-type-value-hero` 80/84 px, Gewicht 600, Laufweite −0,03 em. Zahlen `tabular-nums`.
- Touch-Ziele ≥ `--smart-size-touch` (48 px); Farbe nie alleiniger Träger; `prefers-reduced-motion` → nur Opazität.
- Zeit: speichern und übertragen nur UTC; Anzeige in Haushalts-Zeitzone; Tests auch unter `TZ=Pacific/Chatham`.
- Rollen: Schwellen ändern `owner` und `member`; Layout ändert jedes Mitglied nur für sich; `hardware_new` sieht nur `owner`, `cert_expiring` nur `owner` und Plattform-Admin.

## Review Focus

1. **Viele Hinweise mit einem Gateway offline:** genau ein Eintrag für das Gateway, keine Einträge seiner Geräte, Zähler = Einträge nach Unterdrückung, Hero höchstens drei Gruppen. → Tests in Task 4 (Backend) und Task 8 (Darstellung).
2. **Gespeichertes Layout passt nicht mehr** (unbekannte Block-ID, neuer Block, leeres Array, doppelte IDs): App zeigt einen gültigen Stand, nichts stürzt ab. → Tests in Task 2 (`normalizeOverviewLayout`) und Task 8.
3. **Unsinnige Schwellen** (untere ≥ obere Feuchte, Prozent außerhalb 0–100, Dauer < 1 min, `null` zum Zurücksetzen, viewer ändert): 400 bzw. 403, Standard greift wieder. → Tests in Task 3.
4. **Grenzfälle der Theme-Kombinationen** (dunkel + hoher Kontrast, rote Grundfarbe, bei der `error` und `primary` zusammenrücken): Hero in `error-container` bleibt lesbar und von `primary-container` unterscheidbar. → Stories mit axe in Task 7.
5. **Werte flattern um die Schwelle** (Feuchte 24 ↔ 26 %): kein Ein/Aus-Wechsel des Hinweises dank Hysterese; `since` bleibt stabil. → Test in Task 4.

---

### Task 1: Warnfarben-Spike in `@smart/theme`

**Files:** `packages/theme/src/status.ts`, `packages/theme/src/theme.spec.ts` (oder neues `status.spec.ts`), `apps/frontend/projects/ui/src/lib/tokens/default-theme.css` (neu erzeugt mit `pnpm --filter @smart/theme generate:default-css`), Storybook-Story „Statusfarben im Vergleich“ unter `apps/frontend/projects/ui/src/lib/theme/`.

**Verhalten:** `warning` als eigene Palette mit Quellfarbe um HCT-Hue 50 (Orange), harmonisiert wie `dry`/`ok`/`wet` (höchstens 8°). Zuerst ein Test, der die Kriterien misst, dann die Umstellung.

**Tests (messbar, Spec Abschnitt 6):** für die Grundfarben Standard, `#d32f2f` (Rot), `#f9a825` (Gelb) in allen sechs Kombinationen: Hue-Abstand nach Harmonisierung von `warning` zu `error` und zu `dry` ≥ 18°; Kontrast `on-warning` auf `warning` und `on-warning-container` auf `warning-container` ≥ 4,5:1.

- Bestehen alle Kriterien: `STATUS_SOURCES` bekommt `warning`, der Sonderweg „warning = error“ entfällt samt Kommentar, Standard-CSS neu erzeugt, Story zeigt `warning-container`, `error-container`, `dry-container` nebeneinander. Commit `feat(ui): give warnings their own colour`.
- Besteht ein Kriterium nicht: nichts umstellen; nur der Messtest bleibt (als `it.skip` mit Begründung) und das Ergebnis steht im Task-Bericht. Commit `test(ui): measure a separate warning colour`.

---

### Task 2: Contracts – Geräteart, Schwellen, Hinweise, Layout

**Files:** `packages/contracts/src/devices.ts` (`deviceKind`), neue `packages/contracts/src/thresholds.ts`, `packages/contracts/src/attention.ts`, `packages/contracts/src/overview-layout.ts`, Exporte in `index.ts`, Specs daneben.

**Interfaces (Produces – exakt so):**

```ts
// devices.ts
export const DEVICE_KINDS = ['light', 'soil', 'climate', 'contact', 'other'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
/** light: writable `state` or `brightness`; soil: `soil_moisture`; climate: `temperature`/`humidity`
 * without `soil_moisture`; contact: `contact`; else other. */
export function deviceKind(capabilities: readonly Capability[]): DeviceKind;

// thresholds.ts
export const thresholdsSchema = z.object({
  soilMoistureMin: z.optional(z.nullable(z.number().check(z.gte(0), z.lte(100)))),
  soilMoistureMax: z.optional(z.nullable(z.number().check(z.gte(0), z.lte(100)))),
  batteryMin: z.optional(z.nullable(z.number().check(z.gte(0), z.lte(100)))),
  contactOpenMinutes: z.optional(z.nullable(z.int().check(z.gte(1), z.lte(10080)))),
  silentMinutes: z.optional(z.nullable(z.int().check(z.gte(1), z.lte(10080)))),
}); // plus refine: min < max when both are numbers
export type Thresholds = z.infer<typeof thresholdsSchema>;
export interface EffectiveThresholds {
  soilMoistureMin: number | null;
  soilMoistureMax: number | null;
  batteryMin: number;
  contactOpenMinutes: number;
  silentMinutes: number;
}
export const DEFAULT_THRESHOLDS: Record<DeviceKind, EffectiveThresholds>;
// soil: 25 / null / 20 / 10 / 120; all others: null / null / 20 / 10 / 120
export const GATEWAY_OFFLINE_MINUTES = 5;
/** device value ?? kind default; null in `own` means "use the default". */
export function effectiveThresholds(
  kind: DeviceKind,
  own: Thresholds | null | undefined,
): EffectiveThresholds;

// attention.ts
export const ATTENTION_SEVERITIES = ['critical', 'warning', 'info'] as const;
export const ATTENTION_KINDS = [
  'gateway_offline',
  'device_silent',
  'soil_dry',
  'soil_wet',
  'battery_low',
  'contact_open',
  'hardware_new',
  'cert_expiring',
] as const;
export type AttentionSeverity = (typeof ATTENTION_SEVERITIES)[number];
export type AttentionKind = (typeof ATTENTION_KINDS)[number];
export const attentionItemSchema = z.object({
  id: z.string(),
  kind: z.enum(ATTENTION_KINDS),
  severity: z.enum(ATTENTION_SEVERITIES),
  since: z.iso.datetime(),
  deviceId: z.optional(z.string()),
  gatewayId: z.optional(z.string()),
  roomId: z.optional(z.string()),
  name: z.string(),
  value: z.optional(z.number()),
  unit: z.optional(z.string()),
  params: z.record(z.string(), z.unknown()),
});
export type AttentionItem = z.infer<typeof attentionItemSchema>;
export const attentionListSchema = z.object({ items: z.array(attentionItemSchema) });
export const SEVERITY_OF: Record<AttentionKind, AttentionSeverity>;

// overview-layout.ts
export const OVERVIEW_BLOCK_IDS = ['status', 'devices', 'gateway'] as const; // 6c adds 'rooms'
export const overviewLayoutSchema = z.object({
  blocks: z
    .array(z.object({ id: z.string().check(z.maxLength(40)), visible: z.boolean() }))
    .check(z.maxLength(20)),
});
export type OverviewLayout = z.infer<typeof overviewLayoutSchema>;
export interface OverviewBlockDefault {
  id: string;
  defaultVisible: boolean;
  defaultOrder: number;
}
/** Drops unknown and duplicate ids (first wins), appends known blocks that are missing with their
 * default visibility, in default order. */
export function normalizeOverviewLayout(
  stored: OverviewLayout | null,
  known: readonly OverviewBlockDefault[],
): OverviewLayout;
```

**Tests:** `deviceKind` für jede Art und Mischfälle (Bodensensor mit Temperatur ist `soil`; Lampe nur mit lesbarem `state` ist `other`); `effectiveThresholds` mit `null`, fehlend, gesetzt; Schema lehnt min ≥ max, 101 %, 0 min ab; `normalizeOverviewLayout` mit unbekannter ID, Duplikat, leerem Array, `null`, neuem Block. Commit `feat(contracts): describe device kinds, thresholds, attention and the overview layout`.

---

### Task 3: Backend – Schwellen je Gerät

**Files:** `apps/backend/src/core/devices/{devices.schema.ts,devices.repository.ts,devices.service.ts,devices.controller.ts}` und Specs, neue Migration `apps/backend/drizzle/0007_device_thresholds_overview_layout.sql` (gemeinsam mit Task 5: dieser Task legt sie an, Task 5 ergänzt sie vor dem ersten Release), `apps/backend/test/devices.e2e-spec.ts`.

**Verhalten:** Spalte `devices.thresholds jsonb not null default '{}'`. `PATCH /api/v1/households/:id/devices/:deviceId` nimmt zusätzlich `thresholds` (Teilobjekt, `thresholdsSchema`); gesetzte Werte überschreiben, `null` entfernt den Schlüssel. Die Geräte-Antwort enthält `thresholds` (eigene) und `effectiveThresholds`. Rechte: `owner`, `member`; `viewer` → 403. Nach einer Änderung ruft der Service `AttentionService.recomputeDevice(householdId, deviceId)` auf (Schnittstelle aus Task 4; bis dahin ein optionaler Hook `DeviceChanges` als Event im Modul, den Task 4 abonniert – kein Import von `core/attention` in `core/devices`).

**Tests:** Review Focus 3 vollständig (min ≥ max → 400, 101 → 400, 0 min → 400, `null` setzt zurück, viewer → 403, fremder Haushalt → 404); Antwort zeigt Standard der Art, wenn nichts gesetzt ist. Commit `feat(backend): store thresholds per device`.

---

### Task 4: Backend – `core/attention`

**Files:** neu `apps/backend/src/core/attention/{attention.module.ts,attention.service.ts,attention.rules.ts,attention.controller.ts,index.ts}` mit Specs; `apps/backend/test/attention.e2e-spec.ts`; Registrierung im App-Modul.

**Interfaces:**

- `AttentionService.list(householdId: string, role: HouseholdRole, isPlatformAdmin: boolean): AttentionItem[]` (sortiert: Dringlichkeit, dann `since` absteigend).
- `GET /api/v1/households/:id/attention` (viewer) → `attentionListSchema`.
- `AttentionService.recomputeDevice(householdId, deviceId)` und `recomputeHousehold(householdId)`.

**Verhalten (Spec 4.1–4.4):**

- Reine Regel-Funktion `evaluate(snapshot, previous, now): AttentionItem[]` in `attention.rules.ts` (ohne Nest, voll testbar). `snapshot` = Gateways (Status, `status_changed_at`), Geräte mit Art, effektiven Schwellen, Zustand (`soil_moisture`, Flag „trocken“, `battery`, `contact`, `availability`, letzte Meldung) und Gateway-ID, nicht zugeordnete Hardware, Zertifikats-/CRL-Ablauf. `previous` hält die bisherigen Einträge für `since` und Hysterese.
- Unterdrückung: Gateway offline (> 5 min nicht `online`) → ein Eintrag mit `params.affectedDevices`; Geräte dieses Gateways erzeugen keine Einträge.
- Hysterese: `soil_dry` endet erst bei untere Schwelle + 3; `soil_wet` bei obere − 3; `battery_low` bei Schwelle + 5. `since` bleibt, solange der Eintrag besteht.
- `id` stabil je Art und Bezug (`soil_dry:<deviceId>`, `gateway_offline:<gatewayId>`).
- Neuberechnung: beim Start je Haushalt, nach Ingest-Änderungen (Event aus `core/devices`/`core/gateways` über deren `index.ts`, Muster `GatewayEvents`), nach Schwellenänderung und per Takt alle 30 s für Zeitbedingungen. Im Speicher je Haushalt, nicht in der Datenbank.
- Rollenfilter beim Lesen (`hardware_new` owner; `cert_expiring` owner und Plattform-Admin).

**Tests:** Regeln einzeln (jede Art an/aus, Grenzen genau an der Schwelle), Unterdrückung (Gateway offline mit 12 Geräten → genau 1 Eintrag; Gerät stumm bei Gateway online → eigener Eintrag), Hysterese (Review Focus 5: 24 → 26 → 24 % erzeugt keinen Wechsel; erst 28 % beendet), `since` stabil, Rollenfilter, Zeitbedingungen mit Fake-Uhr (`contact_open` nach 10 min, `device_silent` nach 2 h, Gateway nach 5 min). E2E mit Datenbank: Haushalt mit Simulator-Daten, Gateway auf offline → `GET …/attention` liefert genau einen kritischen Eintrag. Commit `feat(backend): compute attention items per household`.

---

### Task 5: Backend – Übersichts-Layout je Mitgliedschaft

**Files:** `apps/backend/src/core/households/{households.schema.ts,…}` (Spalte `memberships.overview_layout jsonb null`), dieselbe Migration wie Task 3 (ergänzen), neuer Controller-Teil `GET`/`PUT`/`DELETE /api/v1/households/:id/me/overview-layout`, `apps/backend/test/overview-layout.e2e-spec.ts`.

**Verhalten:** `GET` liefert das gespeicherte Layout oder `null` (die App normalisiert); `PUT` validiert mit `overviewLayoutSchema`; `DELETE` setzt auf `null`. Jedes Mitglied (auch viewer) nur für die eigene Mitgliedschaft.

**Tests:** speichern und lesen; zwei Mitglieder desselben Haushalts beeinflussen sich nicht; ein User in zwei Haushalten hat zwei Layouts; zu viele Blöcke → 400; Nicht-Mitglied → 404. Commit `feat(backend): store the overview layout per membership`.

---

### Task 6: `@smart/ui` – Tokens und Grundbausteine (Fable)

**Files:** `apps/frontend/projects/ui/src/lib/tokens/` (Shape-Zuordnung, `--smart-size-pod-width: 140px`, `--smart-size-pod-height: 116px`, `--smart-type-value-hero`, Motion-Tokens falls fehlend), `ui-icon-button` (Variante `tonal`), `ui-top-app-bar` (`size: 'small' | 'large'`), `ui-list` (`leadingTone` am Eintrag), neu `ui-value-display`, `ui-progress-band`, `ui-chip-set` (Zähler je Option, `multiple`), Stories, Specs, `projects/ui/README.md`, i18n `ui.*`.

**Verhalten:** wie Spec 2.1–2.6 und Tabelle 7 (Inputs exakt so benannt). `ui-value-display` mit `size: 'hero' | 'large' | 'medium'`; `ui-progress-band` mit `band: { from, to, tone }`, als `role="meter"` mit `aria-valuetext`.

**Tests:** Komponententests für Inputs und ARIA; Stories hell und dunkel, axe ohne Verstöße; Bundle-Zahl im Bericht. Commit `feat(ui): add the tokens and basic building blocks of the new design`.

---

### Task 7: `@smart/ui` – Status-Hero, Einträge, Pods, Reihen, Sheet (Fable)

**Files:** neu `ui-status-hero`, `ui-status-entry`, `ui-device-pod`, `ui-pod-row`, `ui-reorder-list` (CDK Drag-Drop, lazy über `forms.ts`), `UiBottomSheet` (Service: Bottom Sheet auf Compact, Dialog ab Medium, lazy), Stories, Specs, README.

**Interfaces (Produces):** `ui-status-hero` Inputs `tone: 'calm' | 'attention' | 'critical'`, `heading`, `count`, `criticalCount`, `moreLabel`, `moreRoute`, Inhalt per Content Projection; Ruhezeile bei `tone="calm"`. `ui-status-entry` Inputs `icon`, `kindTone`, `title`, `subtitle`, `value`, `severityLabel`, `route`. `ui-device-pod` Inputs `kind: DeviceKind`, `icon`, `value`, `label`, `chip: { text: string; tone: StatusName } | null`, `route` **oder** `pressed: boolean` + `pending: boolean`, Output `toggled`. `ui-pod-row` Input `wrap: boolean`. `ui-reorder-list` Inputs `items`, Template je Zeile, Output `reordered: string[]`. `UiBottomSheet.open<C, D, R>(component: Type<C>, data: D): Promise<R | undefined>`.

**Verhalten:** Spec 2.2, 2.4, 3.1, 3.5, 4.1 Regel 6, 8. Pod im Schalter-Modus mit `aria-pressed`, Schwebezustand bei `pending`; Pod-Reihe mit Snap, Tastatur und ab Medium mit Pfeilen; `ui-reorder-list` verschiebt per Pfeiltaste am fokussierten Griff (`aria-label` aus Input). Hero als `region` mit Überschrift.

**Tests:** Komponententests (Schalter emittiert `toggled`, `pending` sperrt erneutes Schalten, Tastatur-Verschieben, Sheet schließt mit Escape und gibt `undefined`), Stories in allen Kombinationen inkl. Review Focus 4 (dunkel + hoher Kontrast + rote Grundfarbe, Hero `critical` neben `attention`), axe. Bundle-Zahl im Bericht. Commit `feat(ui): add the status hero, device pods and the bottom sheet`.

---

### Task 8: Übersicht – Status, Geräte, Gateway, Anpassen (Fable)

**Files:** `apps/frontend/src/app/core/features/feature-registry.ts` (`overviewBlocks` statt `overviewCards`; `OverviewBlock` mit `id`, `labelKey`, `descriptionKey`, `icon`, `defaultVisible`, `defaultOrder`, Komponente oder Lader), `features/dashboard/*` (Seite neu), neu `features/attention/` (API-Client, Dienst mit Laden alle 60 s, reine Funktionen `groupAttention`, `heroModel`), `features/devices/devices-feature.ts` (Block `devices` statt Karte), Block `gateway` (aus `features/gateways`), i18n, Specs, `tests/e2e/overview.spec.ts`.

**Verhalten:** Reihenfolge und Sichtbarkeit aus `GET …/me/overview-layout`, normalisiert mit `normalizeOverviewLayout` und den registrierten Blöcken; Standard `status`, `devices`, `gateway` aus. Status-Block nach Spec 4.1: Gruppierung je Art (Gruppe mit einem Gerät zeigt das Gerät), Zähler = Einträge, höchstens drei Gruppen, „Alle N Hinweise · n weitere Gruppen“, Farbe nur bei Kritischem `critical`; kritischer Eintrag zeigt den Hero auch bei ausgeblendetem Block; Ruhezeile mit Gateway-Status, Geräteanzahl und letzter Meldung. Block „Geräte“: Pods aller Geräte (Link zur Geräteseite), Chip aus dem Zustand. „Übersicht anpassen“ über das Icon in der Top App Bar → `UiBottomSheet` mit `ui-reorder-list` und Schaltern; „Fertig“ speichert (`PUT`), „Zurücksetzen“ `DELETE`, Schließen verwirft. Ein neu aufgetauchter kritischer Eintrag wird über `UiAnnouncer` `assertive` angesagt, andere Änderungen `polite`. Ab Medium zweispaltig (`ui-grid`), Hero über beide Spalten, Pods brechen um (Spec 3.7).

**Tests:** `groupAttention`/`heroModel` (Review Focus 1: 20 Einträge inkl. Gateway → 3 Gruppen, Zähler 20, „n weitere Gruppen“, Ton `critical`; nur Warnungen → `attention`; leer → `calm`); Layout-Normalisierung in der Seite (Review Focus 2); Sheet speichert und verwirft. E2E (Stack-Test, Simulator): Übersicht zeigt den Hero mit Simulator-Hinweisen; Block ausgeblendet bleibt nach Neuladen ausgeblendet. Bundle-Zahl im Bericht. Commit `feat(frontend): rebuild the overview with status and customisable blocks`.

---

### Task 9: „Alle Hinweise“ und Gerätedetail mit „Grenzwerte“ (Fable)

**Files:** `features/attention/attention-page.ts` (Route `/hinweise`), `features/devices/device-page.ts` (neu gestaltet), neu `features/devices/thresholds-card.ts`, i18n, Specs, E2E-Ergänzung.

**Verhalten:** „Alle Hinweise“ nach Spec 3.4 (Filter-Chips mit Zählern, mehrere wählbar, Abschnitte je Dringlichkeit, Karten je Art, Eintrag führt zum Gerät oder Gateway, Leerzustand „Nichts zu tun“); Gruppen aus dem Hero öffnen die Seite mit vorgewählter Art (Query-Parameter). Gerätedetail nach Spec 3.3 ohne Diagramm (6c): Hero-Karte in der Farbe der Geräteart mit `ui-value-display size="hero"`, Status-Chip, `ui-progress-band` mit Zielbereich aus den effektiven Schwellen, Nebenwerte als Pods. Karte „Grenzwerte“ nach Spec 4.3: nur die Werte, die zu den Fähigkeiten passen; Kennzeichnung „Standard“ oder angepasst; Ändern für owner/member, Anzeige für viewer; „Auf Standard zurücksetzen“ sendet `null`.

**Tests:** Filter und Vorwahl; Leerzustand; Grenzwerte-Karte zeigt nur passende Felder, sendet Teilobjekt, setzt zurück, viewer sieht keine Bedienelemente; Fehler 400 wird als Feldfehler angezeigt. Commit `feat(frontend): show all notices and let thresholds be changed per device`.

---

### Task 10: Bestehende Seiten in der neuen Sprache (Fable)

**Files:** `features/devices/devices-page.ts` und „Neu erkannt“ (Pod-Raster, Karte in `secondary-container`), `features/gateways/*` (Status-Icon-Container, Zertifikat als Chip), `features/more/*` (tonale Icon-Container, Gruppen als Karten), `features/settings/*`, `features/auth/*`, `features/households/*`, Top App Bar (`size="large"` auf Compact), Navigation Bar (aktive Pille in `primary-container`, falls noch nicht so), Storybook-Seitenbeispiele, E2E-Anpassungen.

**Verhalten:** Spec 3.6 und 3.7 (Medium zweispaltig, Expanded bis drei Spalten bis `--smart-size-content-max`); keine Funktionsänderung.

**Tests:** bestehende Tests und E2E bleiben grün (Selektoren nur über Rollen/Texte); Seiten-Stories hell und dunkel mit axe. Bundle-Zahl im Bericht. Commit `feat(frontend): bring the existing pages into the new design`.

---

### Task 11: Dokumentation

**Files:** `CLAUDE.md` (Bundle-Stand, Hinweis auf `overviewBlocks`), `apps/frontend/projects/ui/README.md` (neue Bausteine, falls nicht schon in 6/7), Architektur-Spec 8.7 (Ereignis `attention.changed` als Vorgabe für 6c) und 10.7 (`overviewBlocks`), Designkonzept-Spec: Status „freigegeben“, Abschnitt „Ergebnis und Übertrag“ in diesem Plan.

**Verhalten:** Doku beschreibt den Ist-Stand. Commit `docs: describe the new design language`.
