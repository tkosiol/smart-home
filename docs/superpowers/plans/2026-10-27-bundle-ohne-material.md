# Startbundle ohne Material – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das initiale Bundle sinkt von 482,5 kB auf unter 400 kB, ohne optischen oder Barrierefreiheits-Rückschritt.

**Architecture:** `ui-button` und `ui-icon-button` werden auf nativen Elementen mit eigenem M3-Styling gebaut (gleiche API). `ui-adaptive-shell`, `ui-pod-row` und `UiBottomSheet` nutzen `MEDIA_QUERIES` statt des CDK-`BreakpointObserver`. Feature-Routen von devices, gateways und households bekommen einen zweiten lazy Schritt. Eine Lint-Regel hält Material aus den Dateien von `@smart/ui/shell`.

**Tech Stack:** Angular 22 (zoneless), Vitest, Storybook mit axe, ESLint (Regeln in `tools/lint-config`).

**Spec:** `docs/superpowers/specs/2026-10-27-bundle-ohne-material-design.md`

**Planform:** schlank wie 5b/6b. Exakte Schnittstellen, Verhalten und Tests als Anforderung.

**Freigabe:** Till hat Entwurf und Vorgehen am 2026-10-27 im Chat freigegeben und will ohne Zwischenreview durchziehen („mach alles fertig“). Umsetzung nativ durch Claude, am Ende ein Gesamt-Review durch einen frischen Reviewer.

## Global Constraints

- Gate je Task: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:tz && pnpm build`; Storybook-Tests der berührten Bausteine (`pnpm --filter @smart/frontend test:storybook` bzw. das vorhandene Skript).
- Keine KI-Attribution; Conventional Commits mit Scope (`ui`, `frontend`, `lint`, `docs`); Body-Zeilen ≤ 100 Zeichen.
- In `@smart/ui` nur Tokens: keine Hex-Farben, keine px außerhalb `tokens/`; neue Größen als `--smart-*`-Token.
- Farbe nur über Rollen (`--mat-sys-*`) und `--smart-*`; jede Darstellung in Storybook hell und dunkel mit axe ohne Verstöße.
- Touch-Ziele ≥ `--smart-size-touch`; `prefers-reduced-motion` → keine Bewegung; Forced Colors bleibt bedienbar.
- Öffentliche API von `ui-button`/`ui-icon-button` bleibt gleich; Features ändern sich nicht.
- Nach jedem Task `pnpm build` und den Initial-Wert im Commit-Body nennen.

## Review Focus

1. **Button in einem `<form>`:** `type="submit"` sendet, `type="button"` nicht, deaktiviert weder Klick noch Submit. → Task 2 (vorhandene Tests bleiben grün).
2. **Fokus per Tastatur auf farbigen Flächen** (Banner, Snackbar): Fokusring sichtbar in der Farbe der Fläche, nicht in primary. → Task 3, Stories Banner/Snackbar mit `focus()` und axe.
3. **Doppeltes Auslösen:** Enter/Leertaste auf dem nativen Button feuert `pressed` genau einmal (kein zusätzlicher Key-Handler). → Task 2, Test mit `keydown`/`click`.
4. **Fensterbreite wechselt während der Laufzeit:** Shell wechselt Navigation ohne Neuladen; Abmelden der Listener beim Zerstören. → Task 1, Test mit `FakeMediaQueries.emit`.
5. **Link-Button deaktiviert?** `route` + `disabled` ist kein unterstützter Fall; der Link bleibt ein Link (Doku im JSDoc), `pressed` feuert nie. → Task 2, vorhandener Test „as a link“.

---

### Task 1: Breakpoints ohne CDK

**Files:**

- Modify: `apps/frontend/projects/ui/src/lib/theme/media-queries.ts` (neu: `mediaQuerySignal`)
- Create: `apps/frontend/projects/ui/src/lib/theme/testing/fake-media-queries.ts`
- Modify: `adaptive-shell/adaptive-shell.ts`, `device-pod/pod-row.ts`, `sheet/bottom-sheet.ts` und deren Specs/Stories, `snackbar/snackbar.stories.ts`, `theme/theme.service.spec.ts`
- Test: `apps/frontend/projects/ui/src/lib/theme/media-queries.spec.ts`

**Interfaces:**

- Produces: `mediaQuerySignal(query: string): Signal<boolean>` (im Injection Context; Startwert `MEDIA_QUERIES.matches(query)`, folgt `listen`, meldet sich über `DestroyRef` ab). `class FakeMediaQueries implements MediaQueries` mit `state`, `emit(query, matches)`.

- [ ] Test: Startwert aus `matches`; `emit` ändert das Signal; nach `destroy` kein Listener mehr aktiv.
- [ ] `mediaQuerySignal` umsetzen; `FakeMediaQueries` aus `theme.service.spec.ts` herauslösen.
- [ ] `ui-adaptive-shell`: `windowClass` aus zwei `mediaQuerySignal`s; Specs und Stories auf `FakeMediaQueries` (Story „echter Observer“ nutzt die echte `MEDIA_QUERIES`).
- [ ] `ui-pod-row`: `medium` über `mediaQuerySignal(MEDIUM)`. `UiBottomSheet`: `inject(MEDIA_QUERIES).matches(MEDIUM)`.
- [ ] Test für den Wechsel der Shell während der Laufzeit (Review Focus 4).
- [ ] Gate, Commit `refactor(ui): follow breakpoints without the cdk`.

### Task 2: `ui-button` ohne Material

**Files:**

- Modify: `apps/frontend/projects/ui/src/lib/button/button.{ts,html,scss,spec.ts,stories.ts}`
- Modify: `apps/frontend/projects/ui/src/lib/tokens/layout.css` (neu: `--smart-size-button: 40px`, `--smart-size-icon-button: 40px`, `--smart-focus-offset: 2px`, `--smart-shape-control-pressed: var(--mat-sys-corner-medium)` in `shape.css`)

**Interfaces:**

- Consumes: Tokens oben.
- Produces: Custom Properties `--ui-button-text-color` (Label- und State-Layer-Farbe der Variante `text`), `--ui-focus-color` (Fokusring; gilt auch für `ui-icon-button`).

- [ ] Tests ergänzen: Enter/Leertaste lösen genau ein `pressed` aus; `data-variant` am Host; Symbol mit Abstand; deaktiviert hat kein `tabindex` und ist nicht fokussierbar.
- [ ] Template: `<button class="ui-button">`/`<a class="ui-button">` mit `[attr.data-variant]` am Host, ohne `matButton`.
- [ ] SCSS nach Spec Abschnitt 3: Varianten, State Layer (`::before`), Touch-Ziel (`::after`, min. `--smart-size-touch`), Druck-Morph der Ecken, deaktiviert, `:focus-visible`, Forced Colors, `prefers-reduced-motion`.
- [ ] Stories: alle Varianten mit/ohne Symbol, deaktiviert, Link, `fullWidth`, Fokus; hell und dunkel mit axe; Play-Test misst das Touch-Ziel am eigenen Element.
- [ ] Gate, Commit `feat(ui): build the button without material`.

### Task 3: `ui-icon-button` ohne Material, Overrides umstellen

**Files:**

- Modify: `apps/frontend/projects/ui/src/lib/button/icon-button.{ts,html,scss,spec.ts,stories.ts}`
- Modify: `banner/banner.scss`, `reorder-list/reorder-list.scss`, `snackbar/snackbar-content.{ts,html}`, `snackbar/*.scss` bzw. `tokens/_material.scss`, `top-app-bar/top-app-bar.stories.ts`, `snackbar/snackbar.stories.ts`

**Interfaces:**

- Consumes: `--ui-button-text-color`, `--ui-focus-color` aus Task 2.
- Produces: `--ui-icon-button-color` (Symbol und State Layer, Standard on-surface-variant), `--ui-icon-button-size` (Standard `--smart-size-icon-button`, `tonal` `--smart-size-touch`).

- [ ] Tests: Name über `aria-label`; projizierter Inhalt ersetzt das Symbol; deaktiviert ohne `pressed`; Link-Modus.
- [ ] Umsetzung nach Spec Abschnitt 3 (40 px, `tonal` 48 px auf surface-container-high, Touch-Ziel 48 px).
- [ ] Banner: `--ui-button-text-color: currentColor` und `--ui-focus-color: currentColor` statt `mat.button-overrides`; `mat.strong-focus-indicators` bleibt für Material-Bausteine im Banner.
- [ ] Reorder-Handle: `--ui-icon-button-size: var(--smart-size-touch)`.
- [ ] Snackbar: Aktion als `ui-button variant="text"` mit `--ui-button-text-color: var(--mat-sys-inverse-primary)`, Schließen mit `--ui-icon-button-color: var(--mat-sys-inverse-on-surface)` und `--ui-focus-color` passend; Override in `_material.scss` entfällt.
- [ ] Stories, die `.mat-mdc-button-touch-target` abfragen, messen das eigene Touch-Ziel; Snackbar-Story prüft die eigene Fläche.
- [ ] `grep -r "@angular/material/button" apps/frontend/projects/ui/src` ist leer.
- [ ] Gate, Commit `feat(ui): build the icon button without material`.

### Task 4: Feature-Routen lazy (#101)

**Files:**

- Modify: `apps/frontend/src/app/features/{devices,gateways,households}/index.ts` und `*.routes.ts`

- [ ] `index.ts` exportiert je Route nur ein `loadChildren` auf `./<feature>.routes` (Muster `features/attention/index.ts`), die eigentlichen Routen samt Text-Providern liegen dahinter.
- [ ] `app.routes.ts` bleibt unverändert (Namen gleich).
- [ ] Gate (inkl. E2E-relevanter Routen-Specs), Commit `perf(frontend): load the remaining feature routes lazily`.

### Task 5: Absicherung und Doku

**Files:**

- Modify: `tools/lint-config/eslint/frontend-restricted-imports.mjs`, `tools/lint-config/test/eslint-architecture.spec.mjs`
- Modify: `apps/frontend/angular.json` (Budget), `CLAUDE.md`, `docs/adr/0011-ui-library-wraps-material.md`, `apps/frontend/projects/ui/README.md`

- [ ] Lint: Die Dateien, die `projects/ui/src/shell.ts` re-exportiert (beim Laden der Konfiguration aus `shell.ts` gelesen), dürfen `@angular/material*` und `@angular/cdk*` nicht statisch importieren (Specs und Stories ausgenommen). Tests: Verstoß in `lib/button/button.ts`, kein Verstoß in `lib/snackbar/snackbar-content.ts`.
- [ ] Budget: `maximumError` auf gemessenen Stand + rund 15 kB, `maximumWarning` 400 kB.
- [ ] `CLAUDE.md`: neuer Bundle-Stand und Grenze; Hinweis, dass Startcode-Bausteine Material nicht nutzen.
- [ ] ADR-0011: Nachtrag nach Spec Abschnitt 7.
- [ ] UI-README: Buttons ohne Material, Custom Properties der Buttons, `mediaQuerySignal`.
- [ ] Issue für „Startcode ohne zod“ (Spec Abschnitt 5) anlegen; #68 und #101 im PR schließen.
- [ ] Gate, Commit `docs: record the material-free startup bundle`.

## Ergebnis und Übertrag

Umgesetzt nativ durch Claude (Opus) in einer Sitzung, Gesamt-Review durch einen frischen Reviewer.

- **Bundle:** 482,5 → 412,0 kB initial (128,4 → 113,6 kB komprimiert). Material/CDK sind aus dem Startcode verschwunden; die Buttons kosten als eigenes CSS rund 11 kB vor der Minifizierung.
- **Ziel verfehlt:** unter 400 kB nur mit dem zod-Hebel → #120. Fehlergrenze 425 kB, Warnung 400 kB.

### Entscheidungen während der Umsetzung

- **Stylelint öffnet `--ui-*`:** Komponenten-Styles durften keine Custom Properties setzen. Die Spec braucht sie als Schnittstelle zwischen Bausteinen (Banner, Snackbar, Reorder-Griff). Erlaubt sind nur `--ui-*`, mit Test; Rohwerte und Hex-Farben bleiben auch darin verboten.
- **Keine lokalen `--_*`-Variablen:** Die Varianten stehen als eigene Selektoren in `button.scss`.
- **Inhalt in `.content`:** `z-index: -1` für den State Layer ist ohne Token nicht erlaubt; der Inhalt liegt stattdessen in einem positionierten `<span class="content">` über dem State Layer.
- **Forced Colors:** kein eigener Block mit Systemfarben, sondern ein transparenter Rand, den der Browser in Forced-Colors-Modi zeichnet.
- **Mixin in `button/_control.scss`, nicht in `tokens/`:** `tokens/` ist von Stylelint ausgenommen.
- **`settings` mit #101:** Die Einstellungen hatten dieselben statischen Routen im Index; ein Test an der App-Wurzel (`src/app/feature-routes.spec.ts`) hält alle Index-Routen als lazy Schritt.
- **Snackbar bleibt Material:** Nur ihr Aktions-Button ist jetzt `ui-button`; die Story prüft weiter Materials Fläche.

### Gesamt-Review (frischer Reviewer, Opus)

Keine kritischen Funde. Behoben, jeweils mit Test, der vorher scheiterte:

- **Tap-Highlight auf Telefonen:** Die Buttons setzen `-webkit-tap-highlight-color: transparent` wie früher Material (Story-Prüfung in „Varianten“ und „Tonal“).
- **Fokusring auf farbigen Flächen:** Banner- und Snackbar-Story prüfen die Ringfarbe und die Farbe der Snackbar-Aktion (per Mutation geprüft: ohne `--ui-focus-color` scheitern beide).
- **Form-Animation beim Drücken:** Der Ruheradius ist endlich (halbe Höhe) statt `corner-full` (9999 px), sonst springt die Ecke erst am Ende der Animation.
- **ESLint-Regel transitiv:** Sie folgt allen statischen, relativen Importen ab `shell.ts` (ohne `import type`), wirft einen Fehler, wenn `shell.ts` fehlt oder nichts exportiert; Tests mit Fixture.

Zurückgestellt (klein): keine Mindestbreite von 64 px mehr für kurze Text-Buttons; Hover überdeckt Fokus im State Layer (8 % statt 12 %, der Ring bleibt); der Spec-Test „fires pressed once …“ beweist für Enter/Leertaste wenig (das deckt die Story ab); Hover-State-Layer bleiben auf Touch-Geräten nach dem Tippen stehen (wie bei Material).

### Übertrag

- #120 Startcode ohne zod.
- Der Dashboard-Test „opens the sheet …“ war einmal unter dem parallelen Gate zu langsam (`vi.waitFor` 1 s auf einen lazy Import); allein dreimal grün.
