# Etappe 6c-1: Verläufe – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Geräteseite zeigt eine Karte „Verlauf“ mit 24 h | 7 Tage | 4 Wochen für jeden numerischen Messwert, gespeist aus einem TimescaleDB-Stundenaggregat.

**Architecture:** `@smart/contracts` bekommt das Verlaufs-Schema und reine Ableitungen (Gießen, Zeit unter Schwelle, Zusammenfassung). Das Backend legt `measurements_hourly` an, rechnet die Historie im Migrationsschritt nach und liefert `GET …/devices/:id/history`. `@smart/ui` bekommt `ui-chart` (ECharts lazy, SVG-Renderer) und frischt Chips und Segmente auf; das Feature `devices` setzt die Karte zusammen.

**Tech Stack:** Angular 22 (zoneless), NestJS, Drizzle, TimescaleDB, zod/mini, Apache ECharts 6 (SVG), Vitest, Testcontainers, Storybook mit axe, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-27-etappe-6c1-verlaeufe-design.md`

**Gestaltungsvorlage:** `/private/tmp/claude-501/-Users-tillkosiol-Projekte-smart/39c582fd-4f3a-49b7-bdcd-d892a3dcd1e7/scratchpad/fable/verlauf-entwurf.html` (Artefakt „Verlauf · Entwurf“) und Screenshots in `…/scratchpad/fable/shots/`. Abweichungen, die Till entschieden hat: gewählter Zeitraum ruhig in `secondary-container` (nicht `primary`), Chips tonal.

**Planform:** schlank wie 6b. Exakte Schnittstellen dort, wo Tasks voneinander abhängen; Verhalten und Tests als Anforderung.

**Freigabe und Ausführung:** Till hat Design und Vorgehen am 2026-10-27 freigegeben („zieh durch“). Subagent-gestützt nach dem Muster aus 6b: Contracts und Backend Sonnet; UI-Tasks mit Oberfläche zuerst Sonnet (Logik, Gerüst, Tests), dann Fable (Gestaltung nach der Vorlage, Screenshot-Prüfung); Reviews je Task Sonnet, Gesamt-Review Opus.

## Global Constraints

- Gate je Task: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:tz && pnpm build`; Backend-Tasks zusätzlich `pnpm --filter @smart/backend test` (Docker); UI-Tasks zusätzlich `pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci`.
- Keine KI-Attribution in Commits/PR; Conventional Commits mit Scope (`contracts`, `backend`, `ui`, `frontend`, `docs`, `deps`); Body-Zeilen ≤ 100 Zeichen. Öffentliches Repo: keine privaten Daten.
- Nach Änderungen an `@smart/contracts`: `pnpm packages:build`.
- Zeit: speichern/übertragen nur UTC (`…Z`), Anzeige in Haushaltszeit, Datumswerte `YYYY-MM-DD`; Tests auch unter `TZ=Pacific/Chatham`.
- Backend-Architektur: `core/*` nur über `index.ts` anderer Core-Module; der Endpunkt gehört zu `core/devices`, Abfragen auf Messwerte zu `core/telemetry`.
- UI-Regeln aus `CLAUDE.md`: Material/CDK nur in `@smart/ui`; kein Feature-CSS; nur Tokens (keine Hex, keine px außerhalb `tokens/`); kein sichtbarer Text ohne Schlüssel; keine `DatePipe`; `ui-chart` nur in `public-api.ts`, nie in `shell.ts`.
- Initiales Bundle ≤ 425 kB (Stand 412,0 kB); ECharts nur per `import()`. Nach jedem UI-Task `pnpm build` und Wert im Commit-Body.
- Neue Abhängigkeit `echarts` (Apache-2.0): exakte Version, Lizenzprüfung (`tools/lint-config/licenses`) grün, `pnpm-workspace.yaml` nur bei Build-Skripten anfassen.
- Darstellung: Farben nur über Rollen, Storybook hell und dunkel mit axe; keine Einblendanimation; `prefers-reduced-motion` respektieren; Touch-Ziele ≥ 48 px.

## Review Focus

1. **Zeitumstellung:** Tageswerte am 25.10.2026 in `Europe/Berlin` (25 h) und Achsenbeschriftung in `Pacific/Chatham` (+13:45) stimmen; kein Tag doppelt oder fehlend. → Tests in Task 3 (Backend) und Task 5 (Achse).
2. **Lücken in den Daten** (Gateway 2 h offline, Sensor ohne Werte in der Nacht): keine Nullen, keine durchgezogene Linie über die Lücke, Zusammenfassung zählt nur vorhandene Buckets. → Tests in Task 1 (Funktionen) und Task 5 (Unterbrechung).
3. **Nachlieferung nach Internetausfall:** Werte älter als die letzte materialisierte Stunde tauchen nach dem Refresh im Verlauf auf; das Nachrechnen im Migrationsschritt ist idempotent. → Test in Task 2.
4. **Gerät ohne Schwelle oder mit eigener Schwelle:** Band folgt `effectiveThresholds.soilMoistureMin`; `null` → kein Band, kein „zu trocken“ in Text und Tabelle. → Test in Task 6.
5. **Schneller Wechsel von Chip/Zeitraum:** eine späte Antwort des vorigen Wunsches überschreibt nie die neue Auswahl. → Test in Task 6.

---

### Task 1: Contracts – Verlauf und Ableitungen (Sonnet)

**Files:** Create `packages/contracts/src/history.ts`, `history.spec.ts`; Modify `packages/contracts/src/index.ts`.

**Interfaces – Produces:**

```ts
export const HISTORY_RANGES = ['24h', '7d', '28d'] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];
export const historyRangeSchema: z.ZodMiniEnum<…>;
export const historyResolutionSchema; // '15m' | '1h'
export const historyPointSchema; // { t: string; avg: number; min: number; max: number; last: number }
export const historyDaySchema; // { date: string; avg; min; max; last; partial: boolean }
export const deviceHistorySchema; // { capability, unit: string|null, range, resolution, from, to, points, days }
export type HistoryPoint, HistoryDay, DeviceHistory, HistoryResolution;
export const historyQuerySchema; // { capability: string (min 1), range: HistoryRange }
export const RESOLUTION_MINUTES: Record<HistoryResolution, number>; // { '15m': 15, '1h': 60 }
export function wateringEvents(points: readonly HistoryPoint[], options?: { minRise?: number }): string[]; // ISO t
export function timeBelow(points: readonly HistoryPoint[], threshold: number, resolution: HistoryResolution): number; // minutes
export interface HistorySummary { low: { value: number; t: string } | null; high: { value: number; t: string } | null; minutesBelow: number | null; waterings: string[]; lastWatering: string | null }
export function historySummary(history: DeviceHistory, threshold: number | null): HistorySummary;
```

- [ ] Tests zuerst: Schema akzeptiert gültige, lehnt fehlende `Z`/falsches Datum ab; `wateringEvents` (Standard `minRise` 10, Sprung genau 10, zwei Anstiege in 2 h = einer, leere Reihe, Lücke dazwischen zählt nicht als Sprung über > 2× Auflösung); `timeBelow` (Lücken zählen nicht); `historySummary` (Schwelle `null` → `minutesBelow: null`; Tief/Hoch aus `min`/`max`).
- [ ] Umsetzung, `pnpm packages:build`, Gate, Commit `feat(contracts): describe device histories`.

### Task 2: Backend – Stundenaggregat und Nachrechnen (Sonnet)

**Files:** Create `apps/backend/drizzle/0009_measurements_hourly.sql` (+ Journal-Eintrag in `drizzle/meta`), `apps/backend/src/core/telemetry/hourly-backfill.ts`; Modify `apps/backend/src/migrate.ts`, `apps/backend/src/core/telemetry/index.ts`; Test `apps/backend/test/measurements-hourly.e2e-spec.ts`, Helfer in `test/helpers/fresh-database.ts` falls nötig.

**Interfaces – Produces:** View `measurements_hourly(bucket, device_id, capability, avg, min, max, last, sum, count)`; `backfillHourly(url: string): Promise<{ from: Date; to: Date } | null>` (exportiert über `core/telemetry/index.ts`, aufgerufen in `migrate.ts` nach `runMigrations`).

- [ ] Migration: `CREATE MATERIALIZED VIEW measurements_hourly WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS SELECT time_bucket('1 hour', time) AS bucket, device_id, capability, avg(value_num), min(value_num), max(value_num), last(value_num, time), sum(value_num), count(value_num) FROM measurements WHERE value_num IS NOT NULL GROUP BY 1,2,3 WITH NO DATA;` + `add_continuous_aggregate_policy(start_offset => '7 days', end_offset => '1 hour', schedule_interval => '30 minutes')`. Handgeschrieben, Hinweis „Keep this part when regenerating“ wie in 0006. Prüfen, dass Drizzles Migrator sie in der Transaktion ausführen kann (Testcontainers).
- [ ] `backfillHourly`: eigene Verbindung (`max: 1`, `TimeZone: 'UTC'`), ermittelt `min(time)` der Rohdaten und die älteste materialisierte Stunde (`_timescaledb_catalog`/`timescaledb_information.continuous_aggregates` oder `SELECT min(bucket) FROM measurements_hourly WITH materialized_only` – Weg im Code begründen), ruft `CALL refresh_continuous_aggregate('measurements_hourly', $from, $to)` außerhalb einer Transaktion, `to` höchstens `now() - 1 hour`; nichts offen → `null`. Protokolliert Bereich oder „nichts nachzurechnen“.
- [ ] Tests: Werte in drei Stunden → avg/min/max/last/sum/count stimmen; Wert der laufenden Stunde ist sofort sichtbar (Echtzeit); Daten von vor 20 Tagen → `backfillHourly` füllt sie, zweiter Aufruf liefert `null`; nach `CALL refresh_continuous_aggregate` erscheinen nachgelieferte Werte (Review Focus 3); `migrate.ts`-Pfad läuft auf leerer DB (Stack-Test deckt den Container ab).
- [ ] Gate inkl. Backend-Tests, Commit `feat(backend): aggregate readings per hour`.

### Task 3: Backend – Verlaufs-API (Sonnet)

**Files:** Create `apps/backend/src/core/telemetry/history.repository.ts`; Modify `core/telemetry/index.ts`, `core/telemetry/telemetry.module.ts`, `core/devices/devices.controller.ts`, `core/devices/devices.service.ts` (oder neuer `device-history.service.ts` in `core/devices`); Test `apps/backend/test/device-history.e2e-spec.ts`.

**Interfaces – Consumes:** Task 1 (`deviceHistorySchema`, `historyQuerySchema`), Task 2 (View). **Produces:** `GET /api/v1/households/:householdId/devices/:deviceId/history?capability&range` → `DeviceHistory`; `HistoryRepository.points(deviceId, capability, from, to, resolution)`, `HistoryRepository.days(deviceId, capability, from, to, timeZone)`.

- [ ] Abfragen nach Spec 2.2: 24 h aus `measurements` mit `time_bucket('15 minutes')`; 7 d/28 d aus `measurements_hourly`; Tage mit `time_bucket('1 day', bucket, $tz)`, Mittel `sum(sum)/sum(count)`, `last(last, bucket)`; `partial`, wenn der Tag vor `from` beginnt oder nach `to` endet. Zeitzone aus dem Haushalt (`HouseholdsRepository` über `core/households/index.ts`).
- [ ] Controller: `@RequireRole('viewer')`; Gerät muss zum Haushalt gehören (gleiche 404 wie `get`); Messwert muss in `device.capabilities` lesbar, numerisch und keine Einstellung sein, sonst 400 `validation.failed`; `range` per `historyQuerySchema`.
- [ ] Tests (Testcontainers): Antwort passt zu `deviceHistorySchema`; 24 h liefert 15-min-Buckets, 7 d Stundenwerte, 28 d zusätzlich Tage; Berlin 25.10.2026 hat genau einen Tag mit 25 Stundenbuckets, Chatham-Tage beginnen um 00:00 lokal (Review Focus 1); fremder Haushalt und unbekanntes Gerät 404; Einstellung/`binary`/unbekannt/ungültiger Zeitraum 400; ohne Werte leere Arrays; `viewer` darf lesen.
- [ ] Gate inkl. Backend-Tests, Commit `feat(backend): serve device histories`.

### Task 4: UI – Chips tonal, Segmente als Buttongruppe (Sonnet → Fable)

**Files:** Modify `apps/frontend/projects/ui/src/lib/chip-set/*`, `segmented-button/*` (scss, stories, specs), ggf. Tokens.

- [ ] Sonnet: Tests/Stories, die das neue Aussehen festhalten (Farbe nicht gewählter Chips = `surface-container-high`, kein Rand; gewähltes Segment `secondary-container`; Höhe 40 px; Touch-Ziel ≥ 48 px; Chip-Reihe scrollt auf 320 px ohne Seitenüberlauf).
- [ ] Fable: Gestaltung nach Spec 4.2 und Vorlage (Buttongruppe mit 2 px Abstand, äußere Enden `corner-full`, innere `corner-small`; Druck-Morph wie die Buttons, falls ohne Material machbar; sonst Material-Overrides nur über Tokens); Screenshots hell/dunkel prüfen; bestehende Nutzungen (Einstellungen, Grenzwerte, Theme-Editor) bleiben stimmig.
- [ ] Gate inkl. Storybook, Commit `feat(ui): tonal chips and a quiet button group`.

### Task 5: UI – `ui-chart` (Sonnet → Fable)

**Files:** Create `apps/frontend/projects/ui/src/lib/chart/{chart.ts,chart.html,chart.scss,chart-options.ts,chart-axis.ts,echarts-loader.ts,chart.spec.ts,chart-axis.spec.ts,chart.stories.ts}`; Modify `projects/ui/src/public-api.ts`, `projects/ui/src/lib/tokens/layout.css` (`--smart-size-chart: 200px`, `--smart-size-chart-large: 240px`), UI-i18n (`ui.chart.*`), `apps/frontend/package.json` (`echarts` exakt gepinnt).

**Interfaces – Produces:**

```ts
export type UiChartKind = 'area' | 'ribbon' | 'step';
export interface UiChartPoint {
  readonly t: string;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
}
export interface UiChartBand {
  readonly below: number;
  readonly label: string;
  readonly valueLabel: string;
}
@Component({ selector: 'ui-chart' })
export class UiChart {
  points = input.required<readonly UiChartPoint[]>();
  kind = input<UiChartKind>('area');
  range = input.required<'24h' | '7d' | '28d'>();
  resolutionMinutes = input.required<number>(); // für Lücken: > 2 × Auflösung → Unterbrechung
  timeZone = input.required<string>();
  unit = input<string | null>(null);
  domain = input<{ min: number; max: number } | null>(null);
  band = input<UiChartBand | null>(null);
  markers = input<readonly string[]>([]); // ISO t, als hohle Ringe
  label = input.required<string>(); // aria-label
  description = input.required<string>(); // Textalternative
  scrubbed = output<number | null>(); // Index in points
}
export function chartAxisLabels(
  range,
  from: string,
  to: string,
  timeZone: string,
  narrow: boolean,
  locale: string,
): { t: string; text: string }[]; // reine Funktion, in chart-axis.ts
```

- [ ] Sonnet: `echarts` installieren (exakte Version, Lizenzcheck), `echarts-loader.ts` lädt `echarts/core` + `LineChart` + `GridComponent` + `MarkAreaComponent` + `MarkLineComponent` + `MarkPointComponent` + `VisualMapComponent` + `AxisPointerComponent` + `TooltipComponent` + `SVGRenderer` per `import()`; `chart-options.ts` baut die Optionen als reine Funktion (testbar ohne ECharts); `chart-axis.ts` mit Tests (24 h/7 d/4 W, schmal/breit, „Heute“-Regel, `Pacific/Chatham`); Komponente: lädt ECharts erst im Browser nach dem ersten Rendern, `ResizeObserver`, Farben aus CSS-Variablen (neu bei Theme-Wechsel über `ThemeService`), Scrubbing per `updateAxisPointer`/`globalout` → `scrubbed`, Tastatur (← → Pos1 Ende Esc) per `dispatchAction('showTip')`, `role="group"`, `aria-roledescription`, `aria-label`, `aria-describedby`, Lücken als Unterbrechung (Review Focus 2), `animation: false`. Specs für Optionen, Tastatur und Ausgabe; Stories (Bodenfeuchte 7 Tage mit Band und Gießen-Ringen, 24 h, 4 Wochen, Ribbon Temperatur, Step Batterie, leer, Lücke, 320 px).
- [ ] Fable: Feinschliff nach Vorlage (Hilfslinien, y-Beschriftung mit Halo in der Fläche, Flächenverlauf, Band und Schwellenlinie mit Text, `dry`-Abschnitte, Jetzt-Punkt, Ringe, Hilfslinie beim Wischen), hell/dunkel identisch zur Vorlage; Screenshot-Vergleich mit `…/fable/shots/*`.
- [ ] Bundle messen (initial unverändert, ECharts im lazy Chunk), Gate inkl. Storybook, Commits `feat(ui): add ui-chart on echarts` und ggf. `style(ui): …`.

### Task 6: Feature – Karte „Verlauf“ (Sonnet → Fable)

**Files:** Create `apps/frontend/src/app/features/devices/{history-card.ts,history-card.spec.ts,history-model.ts,history-model.spec.ts}`; Modify `devices.api.ts` (`history(householdId, deviceId, capability, range)`), `device-page.ts` (+ Spec), `devices-testing.ts`, `i18n/{de,en}.json`.

**Interfaces – Consumes:** Tasks 1, 3, 4, 5.

- [ ] Sonnet: `history-model.ts` (reine Funktionen: Chip-Reihenfolge nach Spec 4.3, Darstellung je Messwert/Zeitraum → `UiChartKind` + Punkte, Domain 0–80 für Bodenfeuchte, Band aus `effectiveThresholds.soilMoistureMin`, Texte für Zeile und Zusammenfassung über Schlüssel); `history-card.ts` mit Laden/leer/Fehler, Neuladen alle 5 min solange sichtbar (vorhandenes Refresh-Muster), späte Antworten verwerfen (Review Focus 5), Tabelle; Geräteseite bindet die Karte ein, ab Expanded zweispaltig (über vorhandene `ui-grid`/Layout-Bausteine, kein Feature-CSS). Tests: Chip/Zeitraum lädt neu, Wischen ändert Wert und Zeile, Schwelle `null` → kein Band und kein „zu trocken“ (Review Focus 4), Tabelle 4 Wochen je Tag, Zustände.
- [ ] Fable: Feinschliff der Karte nach Vorlage (Abstände, Typografie, Anordnung „was oben, wann unten“), Screenshots 360 px und 1200 px hell/dunkel mit echten Simulatordaten (lokaler Stack) prüfen.
- [ ] Gate inkl. Storybook, `pnpm i18n:check`, Commit `feat(frontend): show device histories`.

### Task 7: E2E, Doku, Abschluss (Claude)

**Files:** `tests/e2e/devices.spec.ts` (oder neue Spec nach den Regeln in `CLAUDE.md`: keine eigene Code-Anmeldung, Haushalt aus `helpers/accounts.ts`), Architektur-Spec 8.4/8.9, Designkonzept 3.3/7, UI-README, dieser Plan („Ergebnis und Übertrag“).

- [ ] E2E: Geräteseite eines Simulator-Bodensensors zeigt die Karte „Verlauf“, Diagramm sichtbar, „24 h“ umschaltbar, Tabelle zeigt Zeilen.
- [ ] `sh infra/compose/test/stack-test.sh` grün.
- [ ] Doku nach Spec 6; Issue #30 im PR schließen.
- [ ] Gate, Commit `docs: record stage 6c-1`.

## Ergebnis und Übertrag

(wird nach der Umsetzung ergänzt)
