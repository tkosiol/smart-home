# Etappe 3b: Komponenten von `@smart/ui` – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@smart/ui` bietet alle Bausteine, aus denen ab 3c jede Oberfläche entsteht – Layout, Bedienung, Inhalt, Formular, Rückmeldung, Zeit-Pipes und Symbole –, jeweils in Storybook mit allen Varianten, Interaktionstest und axe-Prüfung in zwei Themes.

**Architecture:** Jede Komponente liegt in einem eigenen Ordner unter `apps/frontend/projects/ui/src/lib/<gruppe>/<name>/` (Klasse, Template, SCSS, Story, ggf. Unit-Test) und wird nur über `public-api.ts` exportiert. Angular Material ist internes Detail: Komponenten kapseln Material-Bausteine oder sind (Layout, Liste, Symbol, Skeleton) eigenständig gebaut. Symbole kommen aus einer beim Build erzeugten Teilmenge von Material Symbols (nur gelistete Symbole, Aufruf per Codepoint). Zeit-Pipes formatieren UTC-Zeitstempel über `Intl` in einer zentral gesetzten Zeitzone und Sprache.

**Tech Stack:** Angular 22.2 (Standalone, Signals, Zoneless, OnPush), Angular Material/CDK 22.2.2, Storybook 10.6.1 (`storybook/test`, test-runner 0.26.0, axe-playwright 2.2.2), Vitest 5, `fontkit` 2.0.4 (MIT), `subset-font` 2.9.0 (BSD-3-Clause), `material-symbols` 0.48.0 (Apache-2.0).

**Spec:** `docs/superpowers/specs/2026-10-11-etappe-3-design-system-design.md` (Abschnitte 5, 6, 9, 10) und Architektur-Spec `docs/superpowers/specs/2026-10-11-smart-home-architecture-design.md` (Abschnitte 9, 10.2–10.4, 10.9). Übertrag aus `docs/superpowers/plans/2026-10-11-etappe-3a-theme-fundament.md`, Abschnitt „Ergebnis und Übertrag → Übertrag in Plan 3b“.

**Abgrenzung:** Nicht in 3b: Rahmen-Komponenten (`ui-adaptive-shell`, `ui-top-app-bar`, `ui-badge`), `ui-theme-editor`, Sprache (Transloco), Routen, PWA, App-Icon – alles 3c. Formular-Anbindung an Reactive/Signal Forms folgt mit dem ersten Formular (Login, Etappe 4); 3b-Komponenten binden ihre Werte über `model()`.

**Bewusste Abweichung von Spec 5:** `ui-chip` wird als `ui-chip-set` umgesetzt, das die Chips aus einer Optionsliste rendert. Material-Filterchips brauchen ihren Listbox-Container; ein eigenständiges `ui-chip` innerhalb eines `ui-chip-set` würde von Materials Inhaltsabfrage nicht gefunden (Angular-Projektion), die Tastatur- und Auswahllogik wäre kaputt.

## Global Constraints

- Node 24.21.0, pnpm 12.11.2, TypeScript 6.0.3, Angular 22.2.x, Angular Material/CDK 22.2.2 – wie bisher.
- Neue Pakete exakt: `fontkit@2.0.4`, `subset-font@2.9.0`, `playwright@1.64.0` (Frontend, Dev). `material-symbols@0.48.0` wandert vom Frontend in das neue Werkzeugpaket `@smart/icon-font`.
- Komponenten: Standalone, `ChangeDetectionStrategy.OnPush`, Signal-APIs (`input`, `input.required`, `model`, `output`, `computed`), Selektor-Präfix `ui-`, Klassen-Präfix `Ui` (z. B. `UiButton`), Dateinamen ohne Suffix (`button.ts`, `button.html`, `button.scss`, `button.stories.ts`, `button.spec.ts`).
- **Kein sichtbarer Text in `@smart/ui`:** Jeder Text (Beschriftungen, `aria-label`, Fehlermeldungen) kommt über Inputs vom Aufrufer (Spec 7: kein sichtbarer Text ohne Übersetzungsschlüssel). Storybook-Stories dürfen deutsche Beispieltexte verwenden.
- Styles nur per `styleUrl` in `@smart/ui`; feste Längen, Farben und Zeiten nur in `apps/frontend/projects/ui/src/lib/tokens/` (Stylelint); Komponenten verwenden nur `--mat-sys-*` und `--smart-*`. Anpassungen an Material nur über `mat.*-overrides`-Mixins, keine Selektoren auf `.mat-*`/`.mdc-*` (Spec 10.3). Keine `$`-Variablen in SCSS (Stylelint `scss/no-dollar-variables`).
- Interaktive Elemente: Zielfläche mindestens 48 × 48 px (Materials Touch-Targets bzw. Token `--smart-size-touch` bei eigenen Elementen), sichtbarer Fokus, vollständig per Tastatur bedienbar.
- Jede Komponente hat eine Story mit allen Varianten und eine `play`-Funktion (Interaktionstest); axe (WCAG 2.2 AA inkl. `target-size`) läuft automatisch für jede Story im Standard-Theme **und** im Theme „dunkel, hoher Kontrast, Grundfarbe Bernstein“ (Task 1).
- Zeit: Komponenten und Pipes nehmen nur UTC-Zeitstempel als ISO-Strings mit `Z` an (`utcInstantSchema` aus `@smart/contracts`); Anzeige in der Zeitzone aus `UiFormatContext`; kein `Date` in öffentlichen APIs, kein `DatePipe` (Architektur-Spec 9).
- Exporte ausschließlich über `apps/frontend/projects/ui/src/public-api.ts`.
- Bundle-Budget unverändert: initiales JavaScript < 500 kB (Fehler im Build).
- Code, Kommentare, Commits Englisch; Doku Deutsch; Conventional Commits mit Scope (`ui`, `contracts`, `frontend`, `infra`, `docs`, …), **ohne KI-Attribution**.
- Arbeit auf Branch `feat/etappe-3b-komponenten` (von `main` abgezweigt, enthält diesen Plan).
- Befehle: vor jedem pnpm/node/ng-Aufruf `eval "$(fnm env --shell bash)" && fnm use 24.21.0`. Storybook-Prüfung: `pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci`. UI-Unit-Tests: `pnpm --filter @smart/frontend exec ng test ui --watch=false`.

## Review Focus

1. **Lesbarkeit in allen Themes** (dunkel, hoher Kontrast, andere Grundfarben): Text, Fokusrahmen und Zustände bleiben erkennbar. → Zweiter axe-Durchlauf für jede Story in Task 1.
2. **Nur Tastatur** (Tab, Enter, Leertaste, Pfeiltasten): Jede interaktive Komponente ist ohne Maus bedienbar, der Fokus ist sichtbar. → Tastatur-Schritte in den `play`-Funktionen von Task 4–7 und 9.
3. **Lange deutsche Wörter und schmale Handys (320 px):** kein waagerechtes Scrollen, Texte brechen um. → Story „Schmal“ mit `expectNoHorizontalOverflow` in Task 3, 8, 9 und 10.
4. **Deaktivierte Elemente lösen nichts aus** (auch nicht per Tastatur). → Tests in Task 4, 5 und 9.
5. **Zeitangaben an Umstellungstagen, mit abweichender Browser-Zeitzone und bei ungültigen Zeitstempeln** (ohne `Z`, mit Offset, Unsinn): korrekte Haushaltszeit oder leere Ausgabe statt falscher Zeit. → Tests in Task 11, zusätzlich unter `TZ=Pacific/Chatham`.

---

### Task 1: Grundlagen – Tokens, Storybook-Prüfung in zwei Themes, Übertrag aus 3a

**Files:**

- Modify: `packages/contracts/src/appearance.ts`, `packages/contracts/src/appearance.spec.ts`
- Modify: `apps/frontend/projects/ui/src/lib/tokens/layout.css`
- Create: `apps/frontend/projects/ui/src/lib/testing/story-helpers.ts`
- Modify: `apps/frontend/projects/ui/tsconfig.lib.json`
- Modify: `apps/frontend/.storybook/main.ts`, `apps/frontend/.storybook/preview.ts`, `apps/frontend/.storybook/test-runner.ts`
- Modify: `apps/frontend/package.json`
- Modify: `apps/frontend/nginx/default.conf`, `tests/e2e/specs/stack-smoke.spec.ts`
- Modify: `CLAUDE.md`

**Interfaces:**

- Produces (`@smart/contracts`): `THEME_SHAPES`, `THEME_FONTS`, `THEME_MODES`, `THEME_CONTRASTS` (je `readonly [...] as const`), von den Schemas verwendet.
- Produces (Tokens): `--smart-size-touch`, `--smart-size-icon-{sm,md,lg}`, `--smart-size-grid-{sm,md,lg}`, `--smart-size-content-max`, `--smart-size-skeleton-block`, `--smart-focus-width`, `--smart-line-height-icon`, `--smart-motion-duration-{short,medium,long}`, `--smart-motion-easing-standard`.
- Produces (Stories): `withNarrowFrame` (Decorator, 320 px breiter Rahmen mit Klasse `story-narrow`), `expectNoHorizontalOverflow(element: Element): Promise<void>` aus `lib/testing/story-helpers.ts` (nur für Stories, nicht im öffentlichen API).

- [ ] **Step 1: Failing test – Contracts-Konstanten**

Der Branch `feat/etappe-3b-komponenten` existiert bereits (er enthält diesen Plan); vorher `git switch feat/etappe-3b-komponenten`.

In `packages/contracts/src/appearance.spec.ts` ergänzen (Import der neuen Konstanten oben in den bestehenden Import aufnehmen):

```ts
describe('appearance option lists', () => {
  it('lists every option the schemas accept', () => {
    expect(THEME_SHAPES).toEqual(['kantig', 'standard', 'weich']);
    expect(THEME_FONTS).toEqual(['roboto-flex', 'figtree', 'atkinson']);
    expect(THEME_MODES).toEqual(['system', 'light', 'dark']);
    expect(THEME_CONTRASTS).toEqual(['system', 'standard', 'medium', 'high']);
    for (const shape of THEME_SHAPES) {
      expect(
        instanceAppearanceSchema.safeParse({ ...DEFAULT_INSTANCE_APPEARANCE, shape }).success,
      ).toBe(true);
    }
    for (const font of THEME_FONTS) {
      expect(
        instanceAppearanceSchema.safeParse({ ...DEFAULT_INSTANCE_APPEARANCE, font }).success,
      ).toBe(true);
    }
    for (const mode of THEME_MODES) {
      for (const contrast of THEME_CONTRASTS) {
        expect(personalAppearanceSchema.safeParse({ mode, contrast }).success).toBe(true);
      }
    }
  });
});
```

Run: `pnpm --filter @smart/contracts test`
Expected: FAIL – `THEME_SHAPES` ist nicht exportiert.

- [ ] **Step 2: Konstanten umsetzen**

In `packages/contracts/src/appearance.ts` nach `CORE_COLOR_IDS` ergänzen und die vier `z.enum([...])`-Literale der Schemas durch diese Konstanten ersetzen (`z.enum(THEME_SHAPES)`, `z.enum(THEME_FONTS)`, `z.enum(THEME_MODES)`, `z.enum(THEME_CONTRASTS)`):

```ts
export const THEME_SHAPES = ['kantig', 'standard', 'weich'] as const;
export const THEME_FONTS = ['roboto-flex', 'figtree', 'atkinson'] as const;
export const THEME_MODES = ['system', 'light', 'dark'] as const;
export const THEME_CONTRASTS = ['system', 'standard', 'medium', 'high'] as const;
```

Run: `pnpm --filter @smart/contracts test && pnpm packages:build`
Expected: PASS (bisherige Tests unverändert grün).

- [ ] **Step 3: Tokens ergänzen**

In `apps/frontend/projects/ui/src/lib/tokens/layout.css` innerhalb von `:root` nach `--smart-border-width` ergänzen:

```css
/* Sizes */
--smart-size-touch: 48px;
--smart-size-icon-sm: 20px;
--smart-size-icon-md: 24px;
--smart-size-icon-lg: 40px;
--smart-size-grid-sm: 160px;
--smart-size-grid-md: 240px;
--smart-size-grid-lg: 320px;
--smart-size-content-max: 1200px;
--smart-size-skeleton-block: 96px;
--smart-focus-width: 3px;
--smart-line-height-icon: 1;
/* Motion */
--smart-motion-duration-short: 150ms;
--smart-motion-duration-medium: 300ms;
--smart-motion-duration-long: 1500ms;
--smart-motion-easing-standard: cubic-bezier(0.2, 0, 0, 1);
```

Kommentar der Datei anpassen: `/* Spacing, size, line and motion tokens. Fixed lengths and durations are only allowed in tokens/. */`

- [ ] **Step 4: Story-Helfer**

`apps/frontend/projects/ui/src/lib/testing/story-helpers.ts`:

```ts
import { componentWrapperDecorator } from '@storybook/angular';
import { expect } from 'storybook/test';

/** Renders the story inside a 320px wide frame – the narrowest phone the app supports. */
export const withNarrowFrame = componentWrapperDecorator(
  (story) => `<div class="story-narrow" style="width: 320px; max-width: 100%">${story}</div>`,
);

/** Fails when content is wider than its frame, i.e. the page would scroll sideways. */
export async function expectNoHorizontalOverflow(element: Element): Promise<void> {
  await expect(element.scrollWidth, 'content wider than its frame').toBeLessThanOrEqual(
    element.clientWidth,
  );
}
```

`apps/frontend/projects/ui/tsconfig.lib.json` → `exclude` um `"**/testing/**"` ergänzen (Story-Helfer gehören nicht in die Bibliothek; geprüft werden sie über `.storybook/tsconfig.json`).

- [ ] **Step 5: Storybook-Übertrag aus 3a und zweiter axe-Durchlauf**

`apps/frontend/.storybook/main.ts`: in `config` ergänzen `core: { disableTelemetry: true },`.

`apps/frontend/.storybook/preview.ts`: Import auf `import { DEFAULT_INSTANCE_APPEARANCE, THEME_CONTRASTS, THEME_FONTS, THEME_MODES, THEME_SHAPES, THEME_VARIANTS } from '@smart/contracts';` erweitern und die vier hart kodierten Listen ersetzen:

```ts
    mode: toolbar('Modus', THEME_MODES.filter((mode) => mode !== 'system')),
    contrast: toolbar('Kontrast', THEME_CONTRASTS.filter((contrast) => contrast !== 'system')),
    shape: toolbar('Formen', THEME_SHAPES),
    font: toolbar('Schrift', THEME_FONTS),
```

`apps/frontend/.storybook/test-runner.ts` vollständig ersetzen:

```ts
import type { Page } from 'playwright';
import type { TestRunnerConfig } from '@storybook/test-runner';
import { checkA11y, injectAxe } from 'axe-playwright';

const AXE_OPTIONS = {
  detailedReport: true,
  detailedReportOptions: { html: true },
  axeOptions: {
    // WCAG 2.x A/AA including 2.2 (spec 10); `target-size` is disabled by default in axe-core.
    runOnly: {
      type: 'tag' as const,
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
    },
    rules: { 'target-size': { enabled: true } },
  },
};

/** A second, demanding theme: every story is also checked dark, high contrast, amber seed. */
const SECOND_THEME = 'mode:dark;contrast:high;seed:!hex(8a5a00)';

async function checkStory(page: Page): Promise<void> {
  await injectAxe(page);
  await checkA11y(page, '#storybook-root', AXE_OPTIONS);
}

const config: TestRunnerConfig = {
  async postVisit(page) {
    await checkStory(page);
    const url = new URL(page.url());
    url.searchParams.set('globals', SECOND_THEME);
    await page.goto(url.toString());
    // Fails the story if the second theme was not applied – the check would otherwise be vacuous.
    await page.waitForFunction(
      () =>
        document.documentElement.style.colorScheme === 'dark' &&
        document.querySelector('#storybook-root')?.childElementCount !== 0,
      undefined,
      { timeout: 10_000 },
    );
    await checkStory(page);
  },
};
export default config;
```

`apps/frontend/package.json`:

- `test-storybook:ci`: `http-server storybook-static -p 6006 -s` → `http-server storybook-static -p 6006 -a 127.0.0.1 -s`.
- `pnpm --filter @smart/frontend add -D --save-exact playwright@1.64.0` (bisher nur implizit über Peer-Abhängigkeiten; `test-runner.ts` importiert jetzt Typen daraus).

Run:

```bash
pnpm --filter @smart/frontend typecheck
pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci
```

Expected: Typecheck grün; Test-Runner: beide Farbrollen-Stories grün, im Log je Story zweimal „No accessibility violations detected!“.

Gegenprobe (zeigt, dass der zweite Durchlauf wirklich prüft): `SECOND_THEME` vorübergehend auf `'mode:light'` setzen, Storybook-Tests erneut ausführen → Expected: FAIL mit Timeout in `waitForFunction`. Danach zurücksetzen. Funktioniert die URL-Syntax `globals=` in Storybook 10.6 anders (z. B. Kodierung von `!hex(...)`), die korrekte Syntax aus der Storybook-Doku verwenden und als Ruling festhalten – die Gegenprobe muss weiterhin fehlschlagen.

- [ ] **Step 6: Schriftdateien dauerhaft cachen (nginx) – Test zuerst**

In `tests/e2e/specs/stack-smoke.spec.ts` ergänzen:

```ts
test('hashed font files are cacheable for a year', async ({ page, request }) => {
  await page.goto('/');
  const stylesheet = await page
    .locator('link[rel="stylesheet"][href*="styles-"]')
    .getAttribute('href');
  expect(stylesheet).toBeTruthy();
  const css = await (await request.get(`/${stylesheet}`)).text();
  const font = /url\(["']?(media\/[^"')]+\.woff2)["']?\)/.exec(css)?.[1];
  expect(font, 'a self-hosted woff2 in the global styles').toBeTruthy();
  const response = await request.get(`/${font}`);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
});
```

Run: `sh infra/compose/test/stack-test.sh`
Expected: FAIL – `cache-control` ist `no-cache`.

In `apps/frontend/nginx/default.conf` die Regel `location ~* \.(?:js|css)$ {` zu `location ~* \.(?:js|css|woff2)$ {` ändern (die Dateien unter `media/` tragen einen Inhalts-Hash).

Run: `sh infra/compose/test/stack-test.sh`
Expected: `OK: stack test passed`.

- [ ] **Step 7: CLAUDE.md (Übertrag 3a)**

In `CLAUDE.md`: Tabellenzeile „Contracts nach Änderung neu bauen“ → „Workspace-Pakete (Contracts, Theme) neu bauen“; Satz darunter: „`pnpm install` baut `@smart/contracts` und `@smart/theme` nur bei einer echten Installation …“.

- [ ] **Step 8: Commit**

```bash
pnpm format && pnpm lint
git add packages/contracts apps/frontend tests/e2e CLAUDE.md pnpm-lock.yaml
git commit -m "feat(ui): add size and motion tokens and check every story in a second theme"
```

---

### Task 2: Eigene Symbol-Schrift und `ui-icon`

**Files:**

- Create: `tools/icon-font/package.json`, `tools/icon-font/build-icon-font.mjs`, `tools/icon-font/vitest.config.mjs`, `tools/icon-font/test/icon-font.spec.mjs`
- Create: `apps/frontend/projects/ui/src/lib/icon/icons.json`
- Create (generiert, committet): `apps/frontend/projects/ui/src/lib/icon/icon-codepoints.ts`, `apps/frontend/projects/ui/src/lib/tokens/icon-font.woff2`
- Create: `apps/frontend/projects/ui/src/lib/tokens/icon-font.css`
- Create: `apps/frontend/projects/ui/src/lib/icon/icon.ts`, `icon.scss`, `icon.spec.ts`, `icon.stories.ts`
- Modify: `apps/frontend/projects/ui/src/styles.scss`, `apps/frontend/projects/ui/src/public-api.ts`, `apps/frontend/package.json`, `package.json`, `.prettierignore`

**Interfaces:**

- Produces: `buildIconFont(names: string[], sourceFont: Buffer): Promise<{ font: Buffer; codepoints: Record<string, number> }>`, `renderCodepoints(codepoints): string`, `PATHS` (in `tools/icon-font/build-icon-font.mjs`); Root-Skript `pnpm icons:build`.
- Produces (`@smart/ui`): `UiIcon` (`<ui-icon name="home" />`, Inputs `name: IconName` (required), `label?: string`, `filled: boolean = false`, `size: UiIconSize = 'md'`), Typen `IconName`, `UiIconSize = 'sm' | 'md' | 'lg'`, Konstante `ICON_CODEPOINTS`.

- [ ] **Step 1: Werkzeugpaket anlegen**

`tools/icon-font/package.json`:

```json
{
  "name": "@smart/icon-font",
  "version": "0.0.0",
  "license": "AGPL-3.0-only",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build-icon-font.mjs",
    "test": "vitest run"
  },
  "devDependencies": {
    "fontkit": "2.0.4",
    "material-symbols": "0.48.0",
    "subset-font": "2.9.0",
    "vitest": "5.0.3"
  }
}
```

`tools/icon-font/vitest.config.mjs` als Kopie von `tools/lint-config/vitest.config.mjs`. Root-`package.json`, `scripts`: `"icons:build": "pnpm --filter @smart/icon-font build"`.

```bash
pnpm install
pnpm --filter @smart/frontend remove material-symbols
pnpm licenses:check
```

Expected: `licenses ok (…)` (fontkit MIT, subset-font BSD-3-Clause, harfbuzzjs MIT, material-symbols Apache-2.0). Meldet pnpm Build-Skripte, nicht freigeben, sondern prüfen und berichten.

- [ ] **Step 2: Failing tests**

`tools/icon-font/test/icon-font.spec.mjs`:

```js
import { readFileSync } from 'node:fs';
import * as fontkit from 'fontkit';
import { describe, expect, it } from 'vitest';
import { PATHS, buildIconFont, renderCodepoints } from '../build-icon-font.mjs';

const source = readFileSync(PATHS.source);

describe('buildIconFont', () => {
  it('maps icon names to their Material Symbols codepoints', async () => {
    const { codepoints } = await buildIconFont(['check', 'home'], source);
    expect(codepoints).toEqual({ check: 0xe5ca, home: 0xe88a });
  });

  it('rejects names that are not Material Symbols', async () => {
    await expect(buildIconFont(['home', 'not_an_icon'], source)).rejects.toThrow(
      'Unknown Material Symbols: not_an_icon',
    );
  });

  it('keeps only the listed glyphs and the FILL axis', async () => {
    const { font, codepoints } = await buildIconFont(['check', 'home'], source);
    const subset = fontkit.create(font);
    expect(Object.keys(subset.variationAxes)).toEqual(['FILL']);
    expect(subset.hasGlyphForCodePoint(codepoints.home)).toBe(true);
    expect(subset.hasGlyphForCodePoint(0xe145)).toBe(false); // "add" was not requested
    expect(font.length).toBeLessThan(10_000);
  });

  it('has a sorted list without duplicates', () => {
    const names = JSON.parse(readFileSync(PATHS.names, 'utf8'));
    expect(names).toEqual([...new Set(names)].sort());
  });

  it('committed font and codepoints are up to date (run: pnpm icons:build)', async () => {
    const names = JSON.parse(readFileSync(PATHS.names, 'utf8'));
    const { font, codepoints } = await buildIconFont(names, source);
    expect(readFileSync(PATHS.codepoints, 'utf8')).toBe(renderCodepoints(codepoints));
    expect(Buffer.compare(readFileSync(PATHS.font), font)).toBe(0);
  });
});
```

`apps/frontend/projects/ui/src/lib/icon/icons.json` (sortiert; Symbole für 3b und 3c):

```json
[
  "add",
  "arrow_back",
  "check",
  "check_circle",
  "chevron_right",
  "close",
  "cloud_off",
  "contrast",
  "dark_mode",
  "delete",
  "devices",
  "edit",
  "error",
  "expand_more",
  "home",
  "info",
  "language",
  "light_mode",
  "meeting_room",
  "more_horiz",
  "notifications",
  "palette",
  "refresh",
  "schedule",
  "search",
  "sensors",
  "settings",
  "warning",
  "water_drop",
  "wifi_off"
]
```

Run: `pnpm --filter @smart/icon-font test`
Expected: FAIL – `Cannot find module '../build-icon-font.mjs'`.

- [ ] **Step 3: Generator**

`tools/icon-font/build-icon-font.mjs`:

```js
#!/usr/bin/env node
// Builds the self-hosted icon font: only the Material Symbols (Rounded) listed in icons.json,
// addressed by codepoint, with weight, grade and optical size fixed and the FILL axis kept.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as fontkit from 'fontkit';
import subsetFont from 'subset-font';

const require = createRequire(import.meta.url);
const UI_LIB = new URL('../../apps/frontend/projects/ui/src/lib/', import.meta.url);

export const PATHS = {
  names: fileURLToPath(new URL('icon/icons.json', UI_LIB)),
  codepoints: fileURLToPath(new URL('icon/icon-codepoints.ts', UI_LIB)),
  font: fileURLToPath(new URL('tokens/icon-font.woff2', UI_LIB)),
  source: require.resolve('material-symbols/material-symbols-rounded.woff2'),
};

/** Material Symbols map each icon to a private-use codepoint; the ligature (name) leads to its glyph. */
export async function buildIconFont(names, sourceFont) {
  const font = fontkit.create(sourceFont);
  const codepointOfGlyph = new Map();
  for (const codepoint of font.characterSet) {
    if (codepoint < 0xe000) continue;
    const id = font.glyphForCodePoint(codepoint).id;
    if (!codepointOfGlyph.has(id)) codepointOfGlyph.set(id, codepoint);
  }
  const codepoints = {};
  const unknown = [];
  for (const name of names) {
    const glyphs = font.layout(name).glyphs;
    const codepoint = glyphs.length === 1 ? codepointOfGlyph.get(glyphs[0].id) : undefined;
    if (codepoint === undefined) unknown.push(name);
    else codepoints[name] = codepoint;
  }
  if (unknown.length > 0) throw new Error(`Unknown Material Symbols: ${unknown.join(', ')}`);
  const text = Object.values(codepoints)
    .map((codepoint) => String.fromCodePoint(codepoint))
    .join('');
  const subset = await subsetFont(sourceFont, text, {
    targetFormat: 'woff2',
    variationAxes: { wght: 400, GRAD: 0, opsz: 24 },
  });
  return { font: Buffer.from(subset), codepoints };
}

export function renderCodepoints(codepoints) {
  const entries = Object.entries(codepoints).map(
    ([name, codepoint]) => `  ${name}: 0x${codepoint.toString(16)},`,
  );
  return [
    '// Generated by tools/icon-font from icons.json – do not edit. Regenerate: pnpm icons:build',
    '',
    'export const ICON_CODEPOINTS = {',
    ...entries,
    '} as const;',
    '',
    'export type IconName = keyof typeof ICON_CODEPOINTS;',
    '',
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const names = JSON.parse(readFileSync(PATHS.names, 'utf8'));
  const { font, codepoints } = await buildIconFont(names, readFileSync(PATHS.source));
  writeFileSync(PATHS.font, font);
  writeFileSync(PATHS.codepoints, renderCodepoints(codepoints));
  console.log(`icon font: ${names.length} icons, ${font.length} bytes`);
}
```

`.prettierignore`: `apps/frontend/projects/ui/src/lib/icon/icon-codepoints.ts` ergänzen (generiert).

Run:

```bash
pnpm icons:build
pnpm --filter @smart/icon-font test
```

Expected: `icon font: 30 icons, … bytes` (wenige KB); Tests PASS. Meldet der Generator unbekannte Namen, den Namen in `icons.json` durch den gültigen Material-Symbols-Namen ersetzen (Ruling). Ist der Byte-Vergleich in CI nicht reproduzierbar (anderes Ergebnis auf Linux), den Byte-Vergleich durch einen Vergleich der Glyphenabdeckung (`hasGlyphForCodePoint` für alle Codepoints, Achsen nur `FILL`) ersetzen und als Ruling festhalten.

- [ ] **Step 4: Failing tests – `ui-icon`**

`apps/frontend/projects/ui/src/lib/icon/icon.spec.ts`:

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ICON_CODEPOINTS, type IconName } from './icon-codepoints';
import { UiIcon } from './icon';

@Component({
  imports: [UiIcon],
  template: `<ui-icon [name]="name()" [label]="label()" [filled]="filled()" />`,
})
class Host {
  readonly name = signal<IconName>('home');
  readonly label = signal<string | undefined>(undefined);
  readonly filled = signal(false);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const icon = fixture.nativeElement.querySelector('ui-icon') as HTMLElement;
  return { fixture, icon };
}

describe('UiIcon', () => {
  it('renders the glyph of the named icon', () => {
    const { icon } = render();
    expect(icon.textContent).toBe(String.fromCodePoint(ICON_CODEPOINTS.home));
  });

  it('is hidden from assistive technology without a label', () => {
    const { icon } = render();
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.getAttribute('role')).toBeNull();
  });

  it('is an image with the label as its name when labelled', () => {
    const { fixture, icon } = render();
    fixture.componentInstance.label.set('Feuchtigkeit');
    fixture.detectChanges();
    expect(icon.getAttribute('role')).toBe('img');
    expect(icon.getAttribute('aria-label')).toBe('Feuchtigkeit');
    expect(icon.getAttribute('aria-hidden')).toBeNull();
  });

  it('marks filled icons', () => {
    const { fixture, icon } = render();
    fixture.componentInstance.filled.set(true);
    fixture.detectChanges();
    expect(icon.classList).toContain('ui-icon--filled');
  });
});
```

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: FAIL – `Cannot find module './icon'`.

- [ ] **Step 5: Schrift einbinden und Komponente**

`apps/frontend/projects/ui/src/lib/tokens/icon-font.css`:

```css
/* Self-hosted icon font, generated by tools/icon-font (pnpm icons:build). */
@font-face {
  font-family: 'Smart Symbols';
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url('./icon-font.woff2') format('woff2');
}

:root {
  --smart-font-icons: 'Smart Symbols';
}
```

`apps/frontend/projects/ui/src/styles.scss`: Zeile `@use 'material-symbols/rounded';` ersetzen durch `@use './lib/tokens/icon-font';`.

`apps/frontend/projects/ui/src/lib/icon/icon.ts`:

```ts
import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
} from '@angular/core';
import { ICON_CODEPOINTS, type IconName } from './icon-codepoints';

export type UiIconSize = 'sm' | 'md' | 'lg';

/** A Material Symbol from the self-hosted subset; decorative unless it has a label. */
@Component({
  selector: 'ui-icon',
  template: '{{ glyph() }}',
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.role]': "label() ? 'img' : null",
    '[attr.aria-label]': 'label() ?? null',
    '[attr.aria-hidden]': "label() ? null : 'true'",
    '[attr.data-size]': 'size()',
    '[class.ui-icon--filled]': 'filled()',
  },
})
export class UiIcon {
  readonly name = input.required<IconName>();
  readonly label = input<string>();
  readonly filled = input(false, { transform: booleanAttribute });
  readonly size = input<UiIconSize>('md');

  protected readonly glyph = computed(() => String.fromCodePoint(ICON_CODEPOINTS[this.name()]));
}
```

`apps/frontend/projects/ui/src/lib/icon/icon.scss`:

```scss
:host {
  display: inline-block;
  flex-shrink: 0;
  overflow: hidden;
  font-family: var(--smart-font-icons);
  font-style: normal;
  font-variation-settings: 'FILL' 0;
  line-height: var(--smart-line-height-icon);
  text-align: center;
  user-select: none;
  white-space: nowrap;
}

:host([data-size='sm']) {
  width: var(--smart-size-icon-sm);
  height: var(--smart-size-icon-sm);
  font-size: var(--smart-size-icon-sm);
}

:host([data-size='md']) {
  width: var(--smart-size-icon-md);
  height: var(--smart-size-icon-md);
  font-size: var(--smart-size-icon-md);
}

:host([data-size='lg']) {
  width: var(--smart-size-icon-lg);
  height: var(--smart-size-icon-lg);
  font-size: var(--smart-size-icon-lg);
}

:host(.ui-icon--filled) {
  font-variation-settings: 'FILL' 1;
}
```

`public-api.ts` ergänzen:

```ts
export { UiIcon, type UiIconSize } from './lib/icon/icon';
export { ICON_CODEPOINTS, type IconName } from './lib/icon/icon-codepoints';
```

- [ ] **Step 6: Story**

`apps/frontend/projects/ui/src/lib/icon/icon.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { ICON_CODEPOINTS } from './icon-codepoints';
import { UiIcon } from './icon';

const names = Object.keys(ICON_CODEPOINTS);

const meta: Meta<UiIcon> = {
  title: 'Inhalt/Icon',
  component: UiIcon,
};
export default meta;

export const Alle: StoryObj<UiIcon> = {
  render: () => ({
    props: { names },
    template: `
      <ul style="display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: 12px; padding: 0; list-style: none">
        @for (name of names; track name) {
          <li style="display: flex; align-items: center; gap: 8px"><ui-icon [name]="name" />{{ name }}</li>
        }
      </ul>`,
  }),
  play: async ({ canvasElement }) => {
    await document.fonts.load('24px "Smart Symbols"');
    await expect(document.fonts.check('24px "Smart Symbols"')).toBe(true);
    await expect(canvasElement.querySelectorAll('ui-icon')).toHaveLength(names.length);
  },
};

export const GroessenUndGefuellt: StoryObj<UiIcon> = {
  render: () => ({
    template: `
      <div style="display: flex; align-items: center; gap: 16px">
        <ui-icon name="water_drop" size="sm" />
        <ui-icon name="water_drop" />
        <ui-icon name="water_drop" size="lg" />
        <ui-icon name="water_drop" size="lg" filled label="Feuchtigkeit" />
      </div>`,
  }),
  play: async ({ canvas }) => {
    const labelled = canvas.getByRole('img', { name: 'Feuchtigkeit' });
    await expect(getComputedStyle(labelled).fontVariationSettings).toContain('"FILL" 1');
    await expect(getComputedStyle(labelled).width).toBe('40px');
  },
};
```

(Inline-Styles nur in Story-Templates, nicht in Komponenten.)

- [ ] **Step 7: Prüfen**

```bash
pnpm --filter @smart/frontend exec ng test ui --watch=false
pnpm --filter @smart/frontend build
ls apps/frontend/dist/frontend/browser/media | grep -ci "material-symbols" || echo "no material symbols font"
ls -la apps/frontend/dist/frontend/browser/media/icon-font-*.woff2
pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci
pnpm lint && pnpm --filter @smart/frontend typecheck && pnpm test
```

Expected: UI-Tests grün; im Build keine 5-MB-Datei `material-symbols-rounded-*.woff2` mehr (`no material symbols font` bzw. `0`), stattdessen `icon-font-*.woff2` mit wenigen KB; Storybook-Stories grün in beiden Themes; Lint, Typecheck, alle Tests grün.

- [ ] **Step 8: Commit**

```bash
pnpm format
git add tools/icon-font apps/frontend package.json pnpm-lock.yaml .prettierignore
git commit -m "feat(ui): add a self-hosted icon font subset and ui-icon"
```

---

### Task 3: Layout – `ui-page`, `ui-section`, `ui-stack`, `ui-grid`

**Files:**

- Create: `apps/frontend/projects/ui/src/lib/layout/space.ts`, `apps/frontend/projects/ui/src/lib/layout/_gap.scss`
- Create: `apps/frontend/projects/ui/src/lib/layout/{page,section,stack,grid}/{name}.ts`, `{name}.scss`, `{name}.stories.ts` (Page und Section zusätzlich `{name}.html`)
- Modify: `apps/frontend/projects/ui/src/public-api.ts`

**Interfaces:**

- Consumes: `withNarrowFrame`, `expectNoHorizontalOverflow` (Task 1).
- Produces: `UiSpace = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'`; `UiPage` (`heading?: string`, `description?: string`, Inhalt projiziert); `UiSection` (`heading: string` required, `description?: string`, `level: 2 | 3 = 2`); `UiStack` (`gap: UiSpace = 'md'`, `direction: 'column' | 'row' = 'column'`, `align: 'stretch' | 'start' | 'center' | 'end' = 'stretch'`, `justify: 'start' | 'center' | 'end' | 'space-between' = 'start'`, `wrap: boolean = false`); `UiGrid` (`min: 'sm' | 'md' | 'lg' = 'md'`, `gap: UiSpace = 'md'`).

- [ ] **Step 1: Failing stories (Interaktionstests)**

`apps/frontend/projects/ui/src/lib/layout/stack/stack.stories.ts`:

```ts
import { type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiStack } from './stack';

const meta: Meta<UiStack> = { title: 'Layout/Stack', component: UiStack };
export default meta;

const items = `<span>Eins</span><span>Zwei</span><span>Drei</span>`;

export const Spalte: StoryObj<UiStack> = {
  render: () => ({ template: `<ui-stack data-testid="stack">${items}</ui-stack>` }),
  play: async ({ canvas }) => {
    const style = getComputedStyle(canvas.getByTestId('stack'));
    await expect(style.flexDirection).toBe('column');
    await expect(style.rowGap).toBe('12px');
  },
};

export const ZeileMitUmbruch: StoryObj<UiStack> = {
  render: () => ({
    template: `<ui-stack data-testid="stack" direction="row" gap="lg" align="center" justify="space-between" wrap>${items}</ui-stack>`,
  }),
  play: async ({ canvas }) => {
    const style = getComputedStyle(canvas.getByTestId('stack'));
    await expect(style.flexDirection).toBe('row');
    await expect(style.columnGap).toBe('16px');
    await expect(style.flexWrap).toBe('wrap');
    await expect(style.alignItems).toBe('center');
    await expect(style.justifyContent).toBe('space-between');
  },
};
```

`apps/frontend/projects/ui/src/lib/layout/grid/grid.stories.ts`:

```ts
import { type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../../testing/story-helpers';
import { UiGrid } from './grid';

const meta: Meta<UiGrid> = { title: 'Layout/Grid', component: UiGrid };
export default meta;

const cells = Array.from(
  { length: 6 },
  (_, i) => `<div style="padding: 16px; outline: 1px dashed">Kachel ${i + 1}</div>`,
).join('');

export const Breit: StoryObj<UiGrid> = {
  render: () => ({
    template: `<div style="width: 1000px"><ui-grid data-testid="grid">${cells}</ui-grid></div>`,
  }),
  play: async ({ canvas }) => {
    const columns = getComputedStyle(canvas.getByTestId('grid')).gridTemplateColumns.split(' ');
    await expect(columns.length).toBe(4);
  },
};

export const Schmal: StoryObj<UiGrid> = {
  decorators: [withNarrowFrame],
  render: () => ({ template: `<ui-grid data-testid="grid" min="lg">${cells}</ui-grid>` }),
  play: async ({ canvas, canvasElement }) => {
    const columns = getComputedStyle(canvas.getByTestId('grid')).gridTemplateColumns.split(' ');
    await expect(columns.length).toBe(1);
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};
```

(1000 px Breite, 240 px Mindestbreite, 12 px Abstand → 4 Spalten; 320 px Rahmen mit 320 px Mindestbreite → 1 Spalte, die auf 100 % schrumpft.)

`apps/frontend/projects/ui/src/lib/layout/page/page.stories.ts`:

```ts
import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../../testing/story-helpers';
import { UiSection } from '../section/section';
import { UiPage } from './page';

const meta: Meta<UiPage> = {
  title: 'Layout/Page',
  component: UiPage,
  decorators: [moduleMetadata({ imports: [UiSection] })],
};
export default meta;

const content = `
  <ui-page heading="Darstellung" description="So sieht die App für dich aus.">
    <ui-section heading="Farben" description="Grundfarbe und Variante.">
      <p>Inhalt</p>
    </ui-section>
    <ui-section heading="Unterabschnitt" [level]="3"><p>Mehr Inhalt</p></ui-section>
  </ui-page>`;

export const Standard: StoryObj<UiPage> = {
  render: () => ({ template: content }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 1, name: 'Darstellung' })).toBeVisible();
    await expect(canvas.getByRole('heading', { level: 2, name: 'Farben' })).toBeVisible();
    await expect(canvas.getByRole('heading', { level: 3, name: 'Unterabschnitt' })).toBeVisible();
  },
};

export const SchmalMitLangenWoertern: StoryObj<UiPage> = {
  decorators: [withNarrowFrame],
  render: () => ({
    template: `
      <ui-page heading="Bodenfeuchtigkeitsmessgerätekonfigurationsübersicht">
        <ui-section heading="Benachrichtigungseinstellungsverwaltungsbereich"><p>Donaudampfschifffahrtsgesellschaftskapitänsmütze</p></ui-section>
      </ui-page>`,
  }),
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};
```

(Section bekommt keine eigene Story; sie ist in `Layout/Page` vollständig abgedeckt.)

Run: `pnpm --filter @smart/frontend build-storybook`
Expected: FAIL – Module `./stack`, `./grid`, `./page`, `../section/section` nicht gefunden.

- [ ] **Step 2: Gemeinsame Abstände**

`apps/frontend/projects/ui/src/lib/layout/space.ts`:

```ts
/** Spacing steps of the --smart-space-* tokens. */
export type UiSpace = 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
```

`apps/frontend/projects/ui/src/lib/layout/_gap.scss`:

```scss
// Gap per [data-gap] value; shared by layout components with a `gap: UiSpace` input.
@mixin rules() {
  :host([data-gap='none']) {
    gap: 0;
  }
  :host([data-gap='xs']) {
    gap: var(--smart-space-xs);
  }
  :host([data-gap='sm']) {
    gap: var(--smart-space-sm);
  }
  :host([data-gap='md']) {
    gap: var(--smart-space-md);
  }
  :host([data-gap='lg']) {
    gap: var(--smart-space-lg);
  }
  :host([data-gap='xl']) {
    gap: var(--smart-space-xl);
  }
  :host([data-gap='2xl']) {
    gap: var(--smart-space-2xl);
  }
  :host([data-gap='3xl']) {
    gap: var(--smart-space-3xl);
  }
}
```

- [ ] **Step 3: Komponenten**

`apps/frontend/projects/ui/src/lib/layout/stack/stack.ts`:

```ts
import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import type { UiSpace } from '../space';

/** Arranges its children in a column or row with token-based spacing. */
@Component({
  selector: 'ui-stack',
  template: '<ng-content />',
  styleUrl: './stack.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-gap]': 'gap()',
    '[attr.data-direction]': 'direction()',
    '[attr.data-align]': 'align()',
    '[attr.data-justify]': 'justify()',
    '[class.ui-stack--wrap]': 'wrap()',
  },
})
export class UiStack {
  readonly gap = input<UiSpace>('md');
  readonly direction = input<'column' | 'row'>('column');
  readonly align = input<'stretch' | 'start' | 'center' | 'end'>('stretch');
  readonly justify = input<'start' | 'center' | 'end' | 'space-between'>('start');
  readonly wrap = input(false, { transform: booleanAttribute });
}
```

`stack.scss`:

```scss
@use '../gap';

:host {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

:host([data-direction='row']) {
  flex-direction: row;
}
:host(.ui-stack--wrap) {
  flex-wrap: wrap;
}
:host([data-align='stretch']) {
  align-items: stretch;
}
:host([data-align='start']) {
  align-items: flex-start;
}
:host([data-align='center']) {
  align-items: center;
}
:host([data-align='end']) {
  align-items: flex-end;
}
:host([data-justify='start']) {
  justify-content: flex-start;
}
:host([data-justify='center']) {
  justify-content: center;
}
:host([data-justify='end']) {
  justify-content: flex-end;
}
:host([data-justify='space-between']) {
  justify-content: space-between;
}

@include gap.rules;
```

`apps/frontend/projects/ui/src/lib/layout/grid/grid.ts`:

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { UiSpace } from '../space';

/** Responsive grid: as many columns as fit, each at least `min` wide (never wider than the grid). */
@Component({
  selector: 'ui-grid',
  template: '<ng-content />',
  styleUrl: './grid.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-min]': 'min()', '[attr.data-gap]': 'gap()' },
})
export class UiGrid {
  readonly min = input<'sm' | 'md' | 'lg'>('md');
  readonly gap = input<UiSpace>('md');
}
```

`grid.scss`:

```scss
@use '../gap';

:host {
  display: grid;
  min-width: 0;
}

:host([data-min='sm']) {
  grid-template-columns: repeat(auto-fill, minmax(min(var(--smart-size-grid-sm), 100%), 1fr));
}

:host([data-min='md']) {
  grid-template-columns: repeat(auto-fill, minmax(min(var(--smart-size-grid-md), 100%), 1fr));
}

:host([data-min='lg']) {
  grid-template-columns: repeat(auto-fill, minmax(min(var(--smart-size-grid-lg), 100%), 1fr));
}

@include gap.rules;
```

`apps/frontend/projects/ui/src/lib/layout/section/section.ts`:

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** A titled part of a page; `level` keeps the heading outline correct when sections nest. */
@Component({
  selector: 'ui-section',
  templateUrl: './section.html',
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiSection {
  readonly heading = input.required<string>();
  readonly description = input<string>();
  readonly level = input<2 | 3>(2);
}
```

`section.html`:

```html
<header class="header">
  @if (level() === 2) {
  <h2 class="heading">{{ heading() }}</h2>
  } @else {
  <h3 class="heading heading--small">{{ heading() }}</h3>
  } @if (description(); as description) {
  <p class="description">{{ description }}</p>
  }
</header>
<ng-content />
```

`section.scss`:

```scss
:host {
  display: flex;
  flex-direction: column;
  gap: var(--smart-space-md);
  min-width: 0;
}

.header {
  display: flex;
  flex-direction: column;
  gap: var(--smart-space-xs);
}

.heading {
  margin: 0;
  color: var(--mat-sys-on-surface);
  font: var(--mat-sys-title-large);
  overflow-wrap: anywhere;
  hyphens: auto;
}

.heading--small {
  font: var(--mat-sys-title-medium);
}

.description {
  margin: 0;
  color: var(--mat-sys-on-surface-variant);
  font: var(--mat-sys-body-medium);
  overflow-wrap: anywhere;
}
```

`apps/frontend/projects/ui/src/lib/layout/page/page.ts`:

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Content column of a screen: readable width, responsive padding and the page heading (h1). */
@Component({
  selector: 'ui-page',
  templateUrl: './page.html',
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiPage {
  readonly heading = input<string>();
  readonly description = input<string>();
}
```

`page.html`:

```html
@if (heading(); as heading) {
<header class="header">
  <h1 class="heading">{{ heading }}</h1>
  @if (description(); as description) {
  <p class="description">{{ description }}</p>
  }
</header>
}
<ng-content />
```

`page.scss`:

```scss
:host {
  display: flex;
  flex-direction: column;
  gap: var(--smart-space-xl);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  max-width: var(--smart-size-content-max);
  margin-inline: auto;
  padding: var(--smart-space-lg) clamp(var(--smart-space-lg), 4vw, var(--smart-space-2xl));
}

.header {
  display: flex;
  flex-direction: column;
  gap: var(--smart-space-xs);
}

.heading {
  margin: 0;
  color: var(--mat-sys-on-surface);
  font: var(--mat-sys-headline-small);
  overflow-wrap: anywhere;
  hyphens: auto;
}

.description {
  margin: 0;
  color: var(--mat-sys-on-surface-variant);
  font: var(--mat-sys-body-large);
  overflow-wrap: anywhere;
}
```

`public-api.ts` ergänzen:

```ts
export type { UiSpace } from './lib/layout/space';
export { UiGrid } from './lib/layout/grid/grid';
export { UiPage } from './lib/layout/page/page';
export { UiSection } from './lib/layout/section/section';
export { UiStack } from './lib/layout/stack/stack';
```

- [ ] **Step 4: Prüfen**

```bash
pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci
pnpm lint && pnpm --filter @smart/frontend typecheck
```

Expected: alle Layout-Stories grün (beide Themes); Stylelint akzeptiert `_gap.scss` (Mixin ohne `$`-Variablen). Erwartet der Test „Spalte“ einen anderen Abstand als 12 px, ist der Token-Wert maßgeblich (`--smart-space-md` = 12 px).

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/frontend/projects/ui
git commit -m "feat(ui): add page, section, stack and grid layout components"
```

---

### Task 4: `ui-button` und `ui-icon-button`

**Files:**

- Create: `apps/frontend/projects/ui/src/lib/button/button.ts`, `button.html`, `button.scss`, `button.spec.ts`, `button.stories.ts`
- Create: `apps/frontend/projects/ui/src/lib/button/icon-button.ts`, `icon-button.html`, `icon-button.spec.ts`, `icon-button.stories.ts`
- Modify: `apps/frontend/projects/ui/src/public-api.ts`

**Interfaces:**

- Consumes: `UiIcon`, `IconName` (Task 2).
- Produces: `UiButton` (`variant: UiButtonVariant = 'filled'`, `type: 'button' | 'submit' = 'button'`, `disabled: boolean = false`, `icon?: IconName`, Output `pressed: void`, Beschriftung projiziert); `UiButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated'`; `UiIconButton` (`icon: IconName` required, `label: string` required, `type`, `disabled`, Output `pressed`).

- [ ] **Step 1: Failing tests**

`apps/frontend/projects/ui/src/lib/button/button.spec.ts`:

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiButton } from './button';

@Component({
  imports: [UiButton],
  template: ` <form (submit)="submitted.set(true); $event.preventDefault()">
    <ui-button [disabled]="disabled()" [type]="type()" (pressed)="count.set(count() + 1)"
      >Speichern</ui-button
    >
  </form>`,
})
class Host {
  readonly disabled = signal(false);
  readonly type = signal<'button' | 'submit'>('button');
  readonly count = signal(0);
  readonly submitted = signal(false);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  return { fixture, button, host: fixture.componentInstance };
}

describe('UiButton', () => {
  it('emits pressed on click', () => {
    const { button, host } = render();
    button.click();
    expect(host.count()).toBe(1);
  });

  it('does not emit or submit when disabled', () => {
    const { fixture, button, host } = render();
    host.disabled.set(true);
    host.type.set('submit');
    fixture.detectChanges();
    button.click();
    expect(button.disabled).toBe(true);
    expect(host.count()).toBe(0);
    expect(host.submitted()).toBe(false);
  });

  it('is a plain button by default and submits only as type submit', () => {
    const { fixture, button, host } = render();
    expect(button.type).toBe('button');
    host.type.set('submit');
    fixture.detectChanges();
    button.click();
    expect(host.submitted()).toBe(true);
  });
});
```

`apps/frontend/projects/ui/src/lib/button/icon-button.spec.ts`:

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiIconButton } from './icon-button';

@Component({
  imports: [UiIconButton],
  template: `<ui-icon-button
    icon="close"
    label="Schließen"
    [disabled]="disabled()"
    (pressed)="count.set(count() + 1)"
  />`,
})
class Host {
  readonly disabled = signal(false);
  readonly count = signal(0);
}

describe('UiIconButton', () => {
  it('names the button with its label and emits pressed', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Schließen');
    button.click();
    expect(fixture.componentInstance.count()).toBe(1);
  });

  it('does not emit when disabled', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    expect(fixture.componentInstance.count()).toBe(0);
  });
});
```

`apps/frontend/projects/ui/src/lib/button/button.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent } from 'storybook/test';
import { UiButton } from './button';

const meta: Meta<UiButton> = {
  title: 'Bedienung/Button',
  component: UiButton,
  args: { pressed: fn() },
};
export default meta;
type Story = StoryObj<UiButton>;

export const Varianten: Story = {
  render: (args) => ({
    props: args,
    template: `
      <div style="display: flex; flex-wrap: wrap; gap: 12px">
        <ui-button (pressed)="pressed()">Gefüllt</ui-button>
        <ui-button variant="tonal" icon="add">Tonal mit Icon</ui-button>
        <ui-button variant="outlined">Umrandet</ui-button>
        <ui-button variant="text">Text</ui-button>
        <ui-button variant="elevated">Erhöht</ui-button>
        <ui-button disabled>Deaktiviert</ui-button>
      </div>`,
  }),
  play: async ({ canvas, args }) => {
    const filled = canvas.getByRole('button', { name: 'Gefüllt' });
    await userEvent.tab();
    await expect(filled).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    await expect(args.pressed).toHaveBeenCalledTimes(2);
    await expect(canvas.getByRole('button', { name: 'Deaktiviert' })).toBeDisabled();
    await expect(filled.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
  },
};

export const DeaktiviertLoestNichtsAus: Story = {
  args: { disabled: true },
  render: (args) => ({
    props: args,
    template: `<ui-button [disabled]="disabled" (pressed)="pressed()">Speichern</ui-button>`,
  }),
  play: async ({ canvas, args }) => {
    const button = canvas.getByRole('button', { name: 'Speichern' });
    await userEvent.click(button, { pointerEventsCheck: 0 });
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    await expect(args.pressed).not.toHaveBeenCalled();
  },
};
```

`apps/frontend/projects/ui/src/lib/button/icon-button.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent } from 'storybook/test';
import { UiIconButton } from './icon-button';

const meta: Meta<UiIconButton> = {
  title: 'Bedienung/Icon-Button',
  component: UiIconButton,
  args: { icon: 'notifications', label: 'Benachrichtigungen', pressed: fn() },
};
export default meta;

export const Standard: StoryObj<UiIconButton> = {
  play: async ({ canvas, args }) => {
    const button = canvas.getByRole('button', { name: 'Benachrichtigungen' });
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.pressed).toHaveBeenCalledTimes(1);
    await expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(40);
  },
};
```

Run:

```bash
pnpm --filter @smart/frontend exec ng test ui --watch=false
```

Expected: FAIL – `Cannot find module './button'` / `'./icon-button'`.

- [ ] **Step 2: Implementierung**

`apps/frontend/projects/ui/src/lib/button/button.ts`:

```ts
import { ChangeDetectionStrategy, Component, booleanAttribute, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { UiIcon } from '../icon/icon';
import type { IconName } from '../icon/icon-codepoints';

export type UiButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated';

/** M3 button; the label is projected content. Listen to `pressed`, not `click`. */
@Component({
  selector: 'ui-button',
  imports: [MatButton, UiIcon],
  templateUrl: './button.html',
  styleUrl: './button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiButton {
  readonly variant = input<UiButtonVariant>('filled');
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly icon = input<IconName>();
  readonly pressed = output<void>();
}
```

`button.html`:

```html
<button [matButton]="variant()" [type]="type()" [disabled]="disabled()" (click)="pressed.emit()">
  @if (icon(); as icon) {
  <ui-icon matButtonIcon [name]="icon" size="sm" />
  }
  <ng-content />
</button>
```

`button.scss`:

```scss
:host {
  display: inline-flex;
  max-width: 100%;
}

button {
  max-width: 100%;
}
```

`apps/frontend/projects/ui/src/lib/button/icon-button.ts`:

```ts
import { ChangeDetectionStrategy, Component, booleanAttribute, input, output } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { UiIcon } from '../icon/icon';
import type { IconName } from '../icon/icon-codepoints';

/** Icon-only button; `label` is its accessible name (and must come translated from the caller). */
@Component({
  selector: 'ui-icon-button',
  imports: [MatIconButton, UiIcon],
  templateUrl: './icon-button.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiIconButton {
  readonly icon = input.required<IconName>();
  readonly label = input.required<string>();
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly pressed = output<void>();
}
```

`icon-button.html`:

```html
<button
  matIconButton
  [type]="type()"
  [disabled]="disabled()"
  [attr.aria-label]="label()"
  (click)="pressed.emit()"
>
  <ui-icon [name]="icon()" />
</button>
```

`public-api.ts` ergänzen:

```ts
export { UiButton, type UiButtonVariant } from './lib/button/button';
export { UiIconButton } from './lib/button/icon-button';
```

- [ ] **Step 3: Prüfen**

```bash
pnpm --filter @smart/frontend exec ng test ui --watch=false
pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci
pnpm lint && pnpm --filter @smart/frontend typecheck
```

Expected: Unit-Tests (5) und Stories grün in beiden Themes. Ist das Icon im Button nicht im Icon-Slot von Material (Abstand fehlt), statt `matButtonIcon` die von `MatButton` erwartete Projektion prüfen (Selektor `[matButtonIcon]` laut `button.d.ts`) und als Ruling festhalten.

- [ ] **Step 4: Commit**

```bash
pnpm format
git add apps/frontend/projects/ui
git commit -m "feat(ui): add ui-button and ui-icon-button"
```

---

### Task 5: `ui-switch` und `ui-segmented-button`

**Files:**

- Create: `apps/frontend/projects/ui/src/lib/switch/switch.ts`, `switch.html`, `switch.spec.ts`, `switch.stories.ts`
- Create: `apps/frontend/projects/ui/src/lib/segmented-button/segmented-button.ts`, `segmented-button.html`, `segmented-button.spec.ts`, `segmented-button.stories.ts`
- Modify: `apps/frontend/projects/ui/src/public-api.ts`

**Interfaces:**

- Consumes: `UiIcon`, `IconName`.
- Produces: `UiSwitch` (`label: string` required, `checked = model(false)`, `disabled: boolean`); `UiSegmentedButton<T extends string>` (`options: readonly UiSegmentOption<T>[]` required, `value = model<T>()`, `label: string` required (Gruppenname), `disabled: boolean`); `UiSegmentOption<T> = { value: T; label: string; icon?: IconName }`.

- [ ] **Step 1: Failing tests**

`apps/frontend/projects/ui/src/lib/switch/switch.spec.ts`:

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiSwitch } from './switch';

@Component({
  imports: [UiSwitch],
  template: `<ui-switch label="Benachrichtigungen" [(checked)]="on" [disabled]="disabled()" />`,
})
class Host {
  readonly on = signal(false);
  readonly disabled = signal(false);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const control = fixture.nativeElement.querySelector('button[role="switch"]') as HTMLButtonElement;
  return { fixture, control, host: fixture.componentInstance };
}

describe('UiSwitch', () => {
  it('is a labelled switch reflecting the bound value', () => {
    const { control } = render();
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(
      control.getAttribute('aria-labelledby') ?? control.getAttribute('aria-label'),
    ).toBeTruthy();
  });

  it('writes the new state back to the binding', () => {
    const { fixture, control, host } = render();
    control.click();
    fixture.detectChanges();
    expect(host.on()).toBe(true);
    expect(control.getAttribute('aria-checked')).toBe('true');
  });

  it('does not change when disabled', () => {
    const { fixture, control, host } = render();
    host.disabled.set(true);
    fixture.detectChanges();
    control.click();
    expect(host.on()).toBe(false);
  });
});
```

`apps/frontend/projects/ui/src/lib/segmented-button/segmented-button.spec.ts`:

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiSegmentedButton, type UiSegmentOption } from './segmented-button';

type Mode = 'system' | 'light' | 'dark';

@Component({
  imports: [UiSegmentedButton],
  template: `<ui-segmented-button label="Modus" [options]="options" [(value)]="mode" />`,
})
class Host {
  readonly options: readonly UiSegmentOption<Mode>[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Hell', icon: 'light_mode' },
    { value: 'dark', label: 'Dunkel', icon: 'dark_mode' },
  ];
  readonly mode = signal<Mode>('system');
}

describe('UiSegmentedButton', () => {
  it('names the group and marks the bound option as selected', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const group = fixture.nativeElement.querySelector('mat-button-toggle-group') as HTMLElement;
    expect(group.getAttribute('aria-label')).toBe('Modus');
    const checked = fixture.nativeElement.querySelector('[aria-checked="true"]') as HTMLElement;
    expect(checked.textContent).toContain('System');
  });

  it('writes the chosen option back to the binding', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll(
      'button',
    ) as NodeListOf<HTMLButtonElement>;
    buttons[2]!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.mode()).toBe('dark');
  });
});
```

`apps/frontend/projects/ui/src/lib/switch/switch.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/angular';
import { expect, userEvent } from 'storybook/test';
import { UiSwitch } from './switch';

const meta: Meta<UiSwitch> = {
  title: 'Bedienung/Switch',
  component: UiSwitch,
  args: { label: 'Benachrichtigungen erlauben' },
};
export default meta;

export const Standard: StoryObj<UiSwitch> = {
  play: async ({ canvas }) => {
    const control = canvas.getByRole('switch', { name: 'Benachrichtigungen erlauben' });
    await userEvent.tab();
    await expect(control).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(control).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(canvas.getByText('Benachrichtigungen erlauben'));
    await expect(control).toHaveAttribute('aria-checked', 'false');
  },
};

export const Deaktiviert: StoryObj<UiSwitch> = {
  args: { disabled: true, checked: true },
  play: async ({ canvas }) => {
    const control = canvas.getByRole('switch');
    await userEvent.click(control, { pointerEventsCheck: 0 });
    await expect(control).toHaveAttribute('aria-checked', 'true');
  },
};
```

`apps/frontend/projects/ui/src/lib/segmented-button/segmented-button.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/angular';
import { expect, userEvent } from 'storybook/test';
import { UiSegmentedButton } from './segmented-button';

const meta: Meta<UiSegmentedButton<string>> = {
  title: 'Bedienung/Segmented Button',
  component: UiSegmentedButton,
  args: {
    label: 'Modus',
    value: 'system',
    options: [
      { value: 'system', label: 'System' },
      { value: 'light', label: 'Hell', icon: 'light_mode' },
      { value: 'dark', label: 'Dunkel', icon: 'dark_mode' },
    ],
  },
};
export default meta;

export const Standard: StoryObj<UiSegmentedButton<string>> = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('radiogroup', { name: 'Modus' })).toBeVisible();
    await userEvent.tab();
    await expect(canvas.getByRole('radio', { name: 'System' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard(' ');
    await expect(canvas.getByRole('radio', { name: 'Hell' })).toBeChecked();
    await userEvent.click(canvas.getByRole('radio', { name: 'Dunkel' }));
    await expect(canvas.getByRole('radio', { name: 'Dunkel' })).toBeChecked();
  },
};
```

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: FAIL – Module fehlen.

- [ ] **Step 2: Implementierung**

`apps/frontend/projects/ui/src/lib/switch/switch.ts`:

```ts
import { ChangeDetectionStrategy, Component, booleanAttribute, input, model } from '@angular/core';
import { MatSlideToggle } from '@angular/material/slide-toggle';

/** On/off switch with a visible label; bind with `[(checked)]`. */
@Component({
  selector: 'ui-switch',
  imports: [MatSlideToggle],
  templateUrl: './switch.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiSwitch {
  readonly label = input.required<string>();
  readonly checked = model(false);
  readonly disabled = input(false, { transform: booleanAttribute });
}
```

`switch.html`:

```html
<mat-slide-toggle
  [checked]="checked()"
  [disabled]="disabled()"
  (change)="checked.set($event.checked)"
  >{{ label() }}</mat-slide-toggle
>
```

`apps/frontend/projects/ui/src/lib/segmented-button/segmented-button.ts`:

```ts
import { ChangeDetectionStrategy, Component, booleanAttribute, input, model } from '@angular/core';
import {
  MatButtonToggle,
  MatButtonToggleGroup,
  type MatButtonToggleChange,
} from '@angular/material/button-toggle';
import { UiIcon } from '../icon/icon';
import type { IconName } from '../icon/icon-codepoints';

export interface UiSegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: IconName;
}

/** Single choice among few options (M3 segmented button); bind with `[(value)]`. */
@Component({
  selector: 'ui-segmented-button',
  imports: [MatButtonToggleGroup, MatButtonToggle, UiIcon],
  templateUrl: './segmented-button.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiSegmentedButton<T extends string> {
  readonly options = input.required<readonly UiSegmentOption<T>[]>();
  readonly value = model<T>();
  readonly label = input.required<string>();
  readonly disabled = input(false, { transform: booleanAttribute });

  protected select(change: MatButtonToggleChange): void {
    this.value.set(change.value as T);
  }
}
```

`segmented-button.html`:

```html
<mat-button-toggle-group
  [value]="value()"
  [disabled]="disabled()"
  [hideSingleSelectionIndicator]="false"
  [attr.aria-label]="label()"
  (change)="select($event)"
>
  @for (option of options(); track option.value) {
  <mat-button-toggle [value]="option.value">
    @if (option.icon; as icon) {
    <ui-icon [name]="icon" size="sm" />
    } {{ option.label }}
  </mat-button-toggle>
  }
</mat-button-toggle-group>
```

`public-api.ts` ergänzen:

```ts
export { UiSegmentedButton, type UiSegmentOption } from './lib/segmented-button/segmented-button';
export { UiSwitch } from './lib/switch/switch';
```

- [ ] **Step 3: Prüfen**

```bash
pnpm --filter @smart/frontend exec ng test ui --watch=false
pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci
pnpm lint && pnpm --filter @smart/frontend typecheck
```

Expected: alles grün. Material liefert die Rollen `switch` (Slide-Toggle) und `radiogroup`/`radio` (Toggle-Gruppe mit Einfachauswahl) samt Pfeiltasten. Weicht eine Rolle in Material 22.2.2 ab, die Story auf die tatsächliche, zugängliche Rolle anpassen und als Ruling festhalten; die Tastaturbedienung (Tab, Pfeiltaste, Leertaste) muss bleiben.

- [ ] **Step 4: Commit**

```bash
pnpm format
git add apps/frontend/projects/ui
git commit -m "feat(ui): add ui-switch and ui-segmented-button"
```

---

### Task 6: `ui-chip-set` (Filterchips)

**Files:**

- Create: `apps/frontend/projects/ui/src/lib/chip-set/chip-set.ts`, `chip-set.html`, `chip-set.spec.ts`, `chip-set.stories.ts`
- Modify: `apps/frontend/projects/ui/src/public-api.ts`

**Interfaces:**

- Consumes: `UiIcon`, `IconName`.
- Produces: `UiChipSet<T extends string>` (`options: readonly UiChipOption<T>[]` required, `selected = model<readonly T[]>([])`, `label: string` required, `multiple: boolean = true`); `UiChipOption<T> = { value: T; label: string; icon?: IconName }`.

- [ ] **Step 1: Failing tests**

`apps/frontend/projects/ui/src/lib/chip-set/chip-set.spec.ts`:

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiChipSet, type UiChipOption } from './chip-set';

type Room = 'kitchen' | 'bath' | 'office';

@Component({
  imports: [UiChipSet],
  template: `<ui-chip-set
    label="Räume"
    [options]="options"
    [multiple]="multiple()"
    [(selected)]="selected"
  />`,
})
class Host {
  readonly options: readonly UiChipOption<Room>[] = [
    { value: 'kitchen', label: 'Küche' },
    { value: 'bath', label: 'Bad' },
    { value: 'office', label: 'Büro' },
  ];
  readonly selected = signal<readonly Room[]>(['bath']);
  readonly multiple = signal(true);
}

function options(fixture: { nativeElement: HTMLElement }) {
  return [...fixture.nativeElement.querySelectorAll('[role="option"]')] as HTMLElement[];
}

describe('UiChipSet', () => {
  it('is a named listbox reflecting the bound selection', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="listbox"]').getAttribute('aria-label')).toBe(
      'Räume',
    );
    expect(options(fixture).map((o) => o.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ]);
  });

  it('adds and removes values in multiple mode', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    options(fixture)[0]!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toEqual(['kitchen', 'bath']);
    options(fixture)[1]!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toEqual(['kitchen']);
  });

  it('keeps at most one value in single mode', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.multiple.set(false);
    fixture.detectChanges();
    options(fixture)[2]!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toEqual(['office']);
  });
});
```

`apps/frontend/projects/ui/src/lib/chip-set/chip-set.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/angular';
import { expect, userEvent } from 'storybook/test';
import { UiChipSet } from './chip-set';

const meta: Meta<UiChipSet<string>> = {
  title: 'Bedienung/Chips',
  component: UiChipSet,
  args: {
    label: 'Räume',
    selected: [],
    options: [
      { value: 'kitchen', label: 'Küche' },
      { value: 'bath', label: 'Bad', icon: 'water_drop' },
      { value: 'office', label: 'Arbeitszimmer' },
    ],
  },
};
export default meta;

export const Mehrfachauswahl: StoryObj<UiChipSet<string>> = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('listbox', { name: 'Räume' })).toBeVisible();
    await userEvent.tab();
    await expect(canvas.getByRole('option', { name: 'Küche' })).toHaveFocus();
    await userEvent.keyboard(' ');
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard(' ');
    await expect(canvas.getByRole('option', { name: 'Küche' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(canvas.getByRole('option', { name: 'Bad' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  },
};
```

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: FAIL – Modul fehlt.

- [ ] **Step 2: Implementierung**

`apps/frontend/projects/ui/src/lib/chip-set/chip-set.ts`:

```ts
import { ChangeDetectionStrategy, Component, booleanAttribute, input, model } from '@angular/core';
import { MatChipListbox, MatChipOption, type MatChipListboxChange } from '@angular/material/chips';
import { UiIcon } from '../icon/icon';
import type { IconName } from '../icon/icon-codepoints';

export interface UiChipOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: IconName;
}

/**
 * Filter chips (spec: ui-chip). Rendered from `options` because Material's listbox only finds chip
 * options declared in its own template. Bind the selection with `[(selected)]`.
 */
@Component({
  selector: 'ui-chip-set',
  imports: [MatChipListbox, MatChipOption, UiIcon],
  templateUrl: './chip-set.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiChipSet<T extends string> {
  readonly options = input.required<readonly UiChipOption<T>[]>();
  readonly selected = model<readonly T[]>([]);
  readonly label = input.required<string>();
  readonly multiple = input(true, { transform: booleanAttribute });

  protected change(event: MatChipListboxChange): void {
    const value = event.value as T | T[] | undefined | null;
    this.selected.set(value == null ? [] : Array.isArray(value) ? value : [value]);
  }
}
```

`chip-set.html`:

```html
<mat-chip-listbox [multiple]="multiple()" [attr.aria-label]="label()" (change)="change($event)">
  @for (option of options(); track option.value) {
  <mat-chip-option [value]="option.value" [selected]="selected().includes(option.value)">
    @if (option.icon; as icon) {
    <ui-icon matChipAvatar [name]="icon" size="sm" />
    } {{ option.label }}
  </mat-chip-option>
  }
</mat-chip-listbox>
```

`public-api.ts` ergänzen:

```ts
export { UiChipSet, type UiChipOption } from './lib/chip-set/chip-set';
```

- [ ] **Step 3: Prüfen**

```bash
pnpm --filter @smart/frontend exec ng test ui --watch=false
pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci
pnpm lint && pnpm --filter @smart/frontend typecheck
```

Expected: grün. Die Reihenfolge der Werte in `selected` folgt der Reihenfolge der Optionen (Material liefert die Auswahl in Optionsreihenfolge); erwartet ein Test eine andere Reihenfolge, gilt die Optionsreihenfolge (Ruling).

- [ ] **Step 4: Commit**

```bash
pnpm format
git add apps/frontend/projects/ui
git commit -m "feat(ui): add ui-chip-set filter chips"
```

---

### Task 7: `ui-text-field` und `ui-color-field`

**Files:**

- Create: `apps/frontend/projects/ui/src/lib/text-field/text-field.ts`, `text-field.html`, `text-field.scss`, `text-field.spec.ts`, `text-field.stories.ts`
- Create: `apps/frontend/projects/ui/src/lib/color-field/hex-color.ts`, `hex-color.spec.ts`, `color-field.ts`, `color-field.html`, `color-field.scss`, `color-field.spec.ts`, `color-field.stories.ts`
- Modify: `apps/frontend/projects/ui/src/public-api.ts`

**Interfaces:**

- Produces: `UiTextField` (`label` required, `value = model('')`, `type: 'text' | 'email' | 'password' | 'search' | 'url' | 'tel' = 'text'`, `hint?`, `error?: string | null` (Meldung vom Aufrufer; gesetzt ⇒ Fehlerzustand), `required`, `disabled`, `autocomplete?`, `name?`); `normalizeHexColor(raw: string): string | null`; `UiColorField` (`label`, `pickerLabel`, `invalidMessage` je required, `hint?`, `value = model('#000000')` – immer kleingeschriebenes `#rrggbb`).

- [ ] **Step 1: Failing tests**

`apps/frontend/projects/ui/src/lib/color-field/hex-color.spec.ts`:

```ts
import { normalizeHexColor } from './hex-color';

describe('normalizeHexColor', () => {
  it.each([
    ['#6f9d2f', '#6f9d2f'],
    ['6F9D2F', '#6f9d2f'],
    ['  #ABC ', '#aabbcc'],
    ['abc', '#aabbcc'],
  ])('accepts %j as %j', (raw, expected) => {
    expect(normalizeHexColor(raw)).toBe(expected);
  });

  it.each(['', '#12', '#12345', '#1234567', 'red', '#ggg000', 'rgb(0,0,0)'])(
    'rejects %j',
    (raw) => {
      expect(normalizeHexColor(raw)).toBeNull();
    },
  );
});
```

`apps/frontend/projects/ui/src/lib/text-field/text-field.spec.ts`:

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiTextField } from './text-field';

@Component({
  imports: [UiTextField],
  template: `<ui-text-field
    label="E-Mail"
    type="email"
    hint="Wir schicken dir einen Code."
    [error]="error()"
    [(value)]="email"
    autocomplete="email"
  />`,
})
class Host {
  readonly email = signal('');
  readonly error = signal<string | null>(null);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
  return { fixture, input, host: fixture.componentInstance };
}

describe('UiTextField', () => {
  it('labels the input and passes type and autocomplete', () => {
    const { fixture, input } = render();
    const label = fixture.nativeElement.querySelector('label') as HTMLLabelElement;
    expect(label.textContent).toContain('E-Mail');
    expect(label.htmlFor).toBe(input.id);
    expect(input.type).toBe('email');
    expect(input.getAttribute('autocomplete')).toBe('email');
  });

  it('writes typed text back to the binding', () => {
    const { fixture, input, host } = render();
    input.value = 'till@example.org';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(host.email()).toBe('till@example.org');
  });

  it('shows the error instead of the hint and marks the input invalid', () => {
    const { fixture, input, host } = render();
    expect(fixture.nativeElement.textContent).toContain('Wir schicken dir einen Code.');
    host.error.set('Bitte eine gültige E-Mail-Adresse eingeben.');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Bitte eine gültige E-Mail-Adresse eingeben.',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Wir schicken dir einen Code.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });
});
```

`apps/frontend/projects/ui/src/lib/color-field/color-field.spec.ts`:

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiColorField } from './color-field';

@Component({
  imports: [UiColorField],
  template: `<ui-color-field
    label="Grundfarbe"
    pickerLabel="Grundfarbe wählen"
    invalidMessage="Bitte als #rrggbb eingeben."
    [(value)]="color"
  />`,
})
class Host {
  readonly color = signal('#00687a');
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const text = fixture.nativeElement.querySelector('input[type="text"]') as HTMLInputElement;
  const picker = fixture.nativeElement.querySelector('input[type="color"]') as HTMLInputElement;
  return { fixture, text, picker, host: fixture.componentInstance };
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('UiColorField', () => {
  it('shows the bound color in both inputs', () => {
    const { text, picker } = render();
    expect(text.value).toBe('#00687a');
    expect(picker.value).toBe('#00687a');
    expect(picker.getAttribute('aria-label')).toBe('Grundfarbe wählen');
  });

  it('emits normalized colors only', () => {
    const { fixture, text, host } = render();
    type(text, '#12');
    fixture.detectChanges();
    expect(host.color()).toBe('#00687a');
    type(text, '6F9D2F');
    fixture.detectChanges();
    expect(host.color()).toBe('#6f9d2f');
  });

  it('shows the invalid message after leaving an invalid entry', () => {
    const { fixture, text } = render();
    type(text, 'rot');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Bitte als #rrggbb eingeben.');
    text.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Bitte als #rrggbb eingeben.');
    expect(text.getAttribute('aria-invalid')).toBe('true');
  });

  it('takes the color chosen in the picker', () => {
    const { fixture, picker, host } = render();
    type(picker, '#8a5a00');
    fixture.detectChanges();
    expect(host.color()).toBe('#8a5a00');
  });
});
```

`apps/frontend/projects/ui/src/lib/text-field/text-field.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/angular';
import { expect, userEvent } from 'storybook/test';
import { UiTextField } from './text-field';

const meta: Meta<UiTextField> = {
  title: 'Formular/Textfeld',
  component: UiTextField,
  args: { label: 'Haushaltsname', hint: 'So heißt dein Zuhause in der App.', value: '' },
};
export default meta;

export const Standard: StoryObj<UiTextField> = {
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: 'Haushaltsname' });
    await userEvent.tab();
    await expect(input).toHaveFocus();
    await userEvent.keyboard('Wohnung Süd');
    await expect(input).toHaveValue('Wohnung Süd');
  },
};

export const MitFehler: StoryObj<UiTextField> = {
  args: { value: 'x', error: 'Mindestens 2 Zeichen.' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Haushaltsname' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(canvas.getByText('Mindestens 2 Zeichen.')).toBeVisible();
  },
};
```

`apps/frontend/projects/ui/src/lib/color-field/color-field.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/angular';
import { expect, userEvent } from 'storybook/test';
import { UiColorField } from './color-field';

const meta: Meta<UiColorField> = {
  title: 'Bedienung/Farbfeld',
  component: UiColorField,
  args: {
    label: 'Grundfarbe',
    pickerLabel: 'Grundfarbe wählen',
    invalidMessage: 'Bitte als #rrggbb eingeben.',
    value: '#00687a',
  },
};
export default meta;

export const Standard: StoryObj<UiColorField> = {
  play: async ({ canvas }) => {
    const text = canvas.getByRole('textbox', { name: 'Grundfarbe' });
    await userEvent.clear(text);
    await userEvent.type(text, '8a5a00');
    await expect(canvas.getByLabelText('Grundfarbe wählen')).toHaveValue('#8a5a00');
    await userEvent.clear(text);
    await userEvent.type(text, 'zu');
    await userEvent.tab();
    await expect(canvas.getByText('Bitte als #rrggbb eingeben.')).toBeVisible();
  },
};
```

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: FAIL – Module fehlen.

- [ ] **Step 2: Implementierung**

`apps/frontend/projects/ui/src/lib/color-field/hex-color.ts`:

```ts
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/;

/** `#rrggbb` (lowercase) from user input like `6F9D2F` or `#abc`; null when it is not a hex color. */
export function normalizeHexColor(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  const withHash = text.startsWith('#') ? text : `#${text}`;
  if (!HEX.test(withHash)) return null;
  if (withHash.length === 7) return withHash;
  return `#${[...withHash.slice(1)].map((digit) => digit + digit).join('')}`;
}
```

`apps/frontend/projects/ui/src/lib/text-field/text-field.ts`:

```ts
import { ChangeDetectionStrategy, Component, booleanAttribute, input, model } from '@angular/core';
import type { ErrorStateMatcher } from '@angular/material/core';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';

/** Outlined text field; the caller decides about errors (`error` set ⇒ invalid). Bind `[(value)]`. */
@Component({
  selector: 'ui-text-field',
  imports: [MatFormField, MatLabel, MatHint, MatError, MatInput],
  templateUrl: './text-field.html',
  styleUrl: './text-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiTextField {
  readonly label = input.required<string>();
  readonly value = model('');
  readonly type = input<'text' | 'email' | 'password' | 'search' | 'url' | 'tel'>('text');
  readonly hint = input<string>();
  readonly error = input<string | null>();
  readonly required = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly autocomplete = input<string>();
  readonly name = input<string>();

  protected readonly errorMatcher: ErrorStateMatcher = { isErrorState: () => !!this.error() };

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }
}
```

`text-field.html`:

```html
<mat-form-field appearance="outline">
  <mat-label>{{ label() }}</mat-label>
  <input
    matInput
    [type]="type()"
    [value]="value()"
    [required]="required()"
    [disabled]="disabled()"
    [errorStateMatcher]="errorMatcher"
    [attr.autocomplete]="autocomplete() ?? null"
    [attr.name]="name() ?? null"
    (input)="onInput($event)"
  />
  @if (error(); as error) {
  <mat-error>{{ error }}</mat-error>
  } @else if (hint(); as hint) {
  <mat-hint>{{ hint }}</mat-hint>
  }
</mat-form-field>
```

`text-field.scss`:

```scss
:host {
  display: block;
  min-width: 0;
}

mat-form-field {
  width: 100%;
}
```

`apps/frontend/projects/ui/src/lib/color-field/color-field.ts`:

```ts
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  model,
  signal,
} from '@angular/core';
import type { ErrorStateMatcher } from '@angular/material/core';
import {
  MatError,
  MatFormField,
  MatHint,
  MatIconPrefix,
  MatLabel,
} from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { normalizeHexColor } from './hex-color';

/** Hex color with a native picker; only valid, normalized colors reach `[(value)]`. */
@Component({
  selector: 'ui-color-field',
  imports: [MatFormField, MatLabel, MatHint, MatError, MatInput, MatIconPrefix],
  templateUrl: './color-field.html',
  styleUrl: './color-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiColorField {
  readonly label = input.required<string>();
  readonly pickerLabel = input.required<string>();
  readonly invalidMessage = input.required<string>();
  readonly hint = input<string>();
  readonly value = model('#000000');

  /** What the user typed; follows `value` whenever that changes from outside. */
  protected readonly draft = linkedSignal(() => this.value());
  protected readonly touched = signal(false);
  protected readonly invalid = computed(() => normalizeHexColor(this.draft()) === null);
  protected readonly showError = computed(() => this.invalid() && this.touched());
  protected readonly errorMatcher: ErrorStateMatcher = { isErrorState: () => this.showError() };

  protected onText(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.draft.set(raw);
    const hex = normalizeHexColor(raw);
    if (hex !== null && hex !== this.value()) this.value.set(hex);
  }

  protected onPick(event: Event): void {
    const hex = normalizeHexColor((event.target as HTMLInputElement).value);
    if (hex !== null) this.value.set(hex);
  }
}
```

`color-field.html`:

```html
<mat-form-field appearance="outline">
  <mat-label>{{ label() }}</mat-label>
  <input
    matIconPrefix
    class="picker"
    type="color"
    [value]="value()"
    [attr.aria-label]="pickerLabel()"
    (input)="onPick($event)"
  />
  <input
    matInput
    type="text"
    spellcheck="false"
    autocomplete="off"
    [value]="draft()"
    [errorStateMatcher]="errorMatcher"
    (input)="onText($event)"
    (blur)="touched.set(true)"
  />
  @if (showError()) {
  <mat-error>{{ invalidMessage() }}</mat-error>
  } @else if (hint(); as hint) {
  <mat-hint>{{ hint }}</mat-hint>
  }
</mat-form-field>
```

`color-field.scss`:

```scss
:host {
  display: block;
  min-width: 0;
}

mat-form-field {
  width: 100%;
}

.picker {
  width: var(--smart-size-touch);
  height: var(--smart-size-touch);
  margin-inline-start: var(--smart-space-xs);
  padding: 0;
  border: none;
  border-radius: var(--mat-sys-corner-small);
  background: transparent;
  cursor: pointer;
}
```

`public-api.ts` ergänzen:

```ts
export { UiColorField } from './lib/color-field/color-field';
export { normalizeHexColor } from './lib/color-field/hex-color';
export { UiTextField } from './lib/text-field/text-field';
```

- [ ] **Step 3: Prüfen**

```bash
pnpm --filter @smart/frontend exec ng test ui --watch=false
pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci
pnpm lint && pnpm --filter @smart/frontend typecheck
```

Expected: grün. Aktualisiert jsdom den Fehlerzustand von `matInput` erst nach einem weiteren Änderungsdurchlauf, im Test nach dem Setzen ein zweites `fixture.detectChanges()` ergänzen (Ruling, kein Code-Umbau).

- [ ] **Step 4: Commit**

```bash
pnpm format
git add apps/frontend/projects/ui
git commit -m "feat(ui): add ui-text-field and ui-color-field"
```

---

### Task 8: `ui-card`, `ui-empty-state`, `ui-skeleton`

**Files:**

- Create: `apps/frontend/projects/ui/src/lib/card/card.ts`, `card.html`, `card.scss`, `card.stories.ts`
- Create: `apps/frontend/projects/ui/src/lib/empty-state/empty-state.ts`, `empty-state.html`, `empty-state.scss`, `empty-state.stories.ts`
- Create: `apps/frontend/projects/ui/src/lib/skeleton/skeleton.ts`, `skeleton.html`, `skeleton.scss`, `skeleton.stories.ts`
- Modify: `apps/frontend/projects/ui/src/public-api.ts`

**Interfaces:**

- Consumes: `UiIcon`, `IconName`, Story-Helfer.
- Produces: `UiCard` (`variant: 'filled' | 'outlined' | 'elevated' = 'outlined'`, `heading?`, `subheading?`, Inhalt projiziert, Aktionen über Element mit Attribut `uiCardActions`); `UiCardActions` (Direktive `[uiCardActions]`); `UiEmptyState` (`icon: IconName` required, `heading` required, `text?`, Aktionen über `[uiEmptyStateActions]`); `UiEmptyStateActions`; `UiSkeleton` (`variant: 'text' | 'block' | 'circle' = 'text'`, `lines: number = 1`).

- [ ] **Step 1: Failing stories**

`apps/frontend/projects/ui/src/lib/card/card.stories.ts`:

```ts
import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiButton } from '../button/button';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../testing/story-helpers';
import { UiCard, UiCardActions } from './card';

const meta: Meta<UiCard> = {
  title: 'Inhalt/Card',
  component: UiCard,
  decorators: [moduleMetadata({ imports: [UiCardActions, UiButton] })],
};
export default meta;

export const Varianten: StoryObj<UiCard> = {
  render: () => ({
    template: `
      <div style="display: grid; gap: 16px; max-width: 480px">
        <ui-card heading="Umrandet" subheading="Standard"><p>Inhalt</p></ui-card>
        <ui-card variant="filled" heading="Gefüllt"><p>Inhalt</p></ui-card>
        <ui-card variant="elevated" heading="Erhöht">
          <p>Inhalt</p>
          <div uiCardActions><ui-button variant="text">Details</ui-button></div>
        </ui-card>
      </div>`,
  }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 3, name: 'Umrandet' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Details' })).toBeVisible();
    await expect(canvas.getAllByRole('heading', { level: 3 })).toHaveLength(3);
  },
};

export const Schmal: StoryObj<UiCard> = {
  decorators: [withNarrowFrame],
  render: () => ({
    template: `<ui-card heading="Bodenfeuchtigkeitssensorkalibrierungsergebnis"><p>Donaudampfschifffahrtsgesellschaft</p></ui-card>`,
  }),
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};
```

`apps/frontend/projects/ui/src/lib/empty-state/empty-state.stories.ts`:

```ts
import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiButton } from '../button/button';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../testing/story-helpers';
import { UiEmptyState, UiEmptyStateActions } from './empty-state';

const meta: Meta<UiEmptyState> = {
  title: 'Inhalt/Leer-Zustand',
  component: UiEmptyState,
  decorators: [moduleMetadata({ imports: [UiEmptyStateActions, UiButton] }), withNarrowFrame],
};
export default meta;

export const Raeume: StoryObj<UiEmptyState> = {
  render: () => ({
    template: `
      <ui-empty-state icon="meeting_room" heading="Noch keine Räume" text="Hier erscheinen deine Räume mit ihren Geräten, sobald du sie anlegst.">
        <div uiEmptyStateActions><ui-button icon="add">Raum anlegen</ui-button></div>
      </ui-empty-state>`,
  }),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Noch keine Räume' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Raum anlegen' })).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};
```

`apps/frontend/projects/ui/src/lib/skeleton/skeleton.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiSkeleton } from './skeleton';

const meta: Meta<UiSkeleton> = { title: 'Inhalt/Skeleton', component: UiSkeleton };
export default meta;

export const Varianten: StoryObj<UiSkeleton> = {
  render: () => ({
    template: `
      <div role="status" aria-label="Lädt" aria-busy="true" style="display: grid; gap: 16px; max-width: 360px">
        <ui-skeleton variant="circle" />
        <ui-skeleton [lines]="3" />
        <ui-skeleton variant="block" />
      </div>`,
  }),
  play: async ({ canvasElement }) => {
    const skeletons = canvasElement.querySelectorAll('ui-skeleton');
    await expect(skeletons).toHaveLength(3);
    for (const skeleton of skeletons) await expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    await expect(skeletons[1]!.querySelectorAll('.line')).toHaveLength(3);
  },
};
```

(Die Story zeigt das empfohlene Muster: Der Aufrufer kündigt das Laden mit `role="status"`, `aria-busy` und übersetztem `aria-label` an; die Skeletons selbst sind unsichtbar für Hilfstechnik.)

Run: `pnpm --filter @smart/frontend build-storybook`
Expected: FAIL – Module fehlen.

- [ ] **Step 2: Implementierung**

`apps/frontend/projects/ui/src/lib/card/card.ts`:

```ts
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  computed,
  contentChild,
  input,
} from '@angular/core';
import {
  MatCard,
  MatCardActions,
  MatCardContent,
  MatCardHeader,
  MatCardSubtitle,
  MatCardTitle,
} from '@angular/material/card';

/** Marks the element holding a card's actions (buttons). */
@Directive({ selector: '[uiCardActions]' })
export class UiCardActions {}

/** M3 card; the heading is an h3 because cards sit inside page sections (h1/h2). */
@Component({
  selector: 'ui-card',
  imports: [MatCard, MatCardHeader, MatCardTitle, MatCardSubtitle, MatCardContent, MatCardActions],
  templateUrl: './card.html',
  styleUrl: './card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiCard {
  readonly variant = input<'filled' | 'outlined' | 'elevated'>('outlined');
  readonly heading = input<string>();
  readonly subheading = input<string>();

  protected readonly actions = contentChild(UiCardActions);
  protected readonly appearance = computed(() =>
    this.variant() === 'elevated' ? 'raised' : this.variant(),
  );
}
```

`card.html`:

```html
<mat-card [appearance]="appearance()">
  @if (heading(); as heading) {
  <mat-card-header>
    <h3 mat-card-title class="title">{{ heading }}</h3>
    @if (subheading(); as subheading) {
    <p mat-card-subtitle class="subtitle">{{ subheading }}</p>
    }
  </mat-card-header>
  }
  <mat-card-content>
    <ng-content />
  </mat-card-content>
  @if (actions()) {
  <mat-card-actions align="end">
    <ng-content select="[uiCardActions]" />
  </mat-card-actions>
  }
</mat-card>
```

`card.scss`:

```scss
:host {
  display: block;
  min-width: 0;
}

.title,
.subtitle {
  margin: 0;
  overflow-wrap: anywhere;
  hyphens: auto;
}

mat-card-content {
  overflow-wrap: anywhere;
}
```

`apps/frontend/projects/ui/src/lib/empty-state/empty-state.ts`:

```ts
import { ChangeDetectionStrategy, Component, Directive, contentChild, input } from '@angular/core';
import { UiIcon } from '../icon/icon';
import type { IconName } from '../icon/icon-codepoints';

/** Marks the element holding an empty state's actions. */
@Directive({ selector: '[uiEmptyStateActions]' })
export class UiEmptyStateActions {}

/** Explains what will appear here and, optionally, how to start. */
@Component({
  selector: 'ui-empty-state',
  imports: [UiIcon],
  templateUrl: './empty-state.html',
  styleUrl: './empty-state.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiEmptyState {
  readonly icon = input.required<IconName>();
  readonly heading = input.required<string>();
  readonly text = input<string>();

  protected readonly actions = contentChild(UiEmptyStateActions);
}
```

`empty-state.html`:

```html
<ui-icon class="icon" [name]="icon()" size="lg" />
<h2 class="heading">{{ heading() }}</h2>
@if (text(); as text) {
<p class="text">{{ text }}</p>
} @if (actions()) {
<div class="actions"><ng-content select="[uiEmptyStateActions]" /></div>
}
```

`empty-state.scss`:

```scss
:host {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--smart-space-md);
  min-width: 0;
  padding: var(--smart-space-2xl) var(--smart-space-lg);
  text-align: center;
}

.icon {
  color: var(--mat-sys-primary);
}

.heading {
  margin: 0;
  color: var(--mat-sys-on-surface);
  font: var(--mat-sys-title-large);
  overflow-wrap: anywhere;
  hyphens: auto;
}

.text {
  max-width: 40ch;
  margin: 0;
  color: var(--mat-sys-on-surface-variant);
  font: var(--mat-sys-body-large);
  overflow-wrap: anywhere;
}

.actions {
  margin-top: var(--smart-space-sm);
}
```

`apps/frontend/projects/ui/src/lib/skeleton/skeleton.ts`:

```ts
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  numberAttribute,
} from '@angular/core';

/** Placeholder while content loads; hidden from assistive technology (announce loading around it). */
@Component({
  selector: 'ui-skeleton',
  templateUrl: './skeleton.html',
  styleUrl: './skeleton.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', '[attr.data-variant]': 'variant()' },
})
export class UiSkeleton {
  readonly variant = input<'text' | 'block' | 'circle'>('text');
  readonly lines = input(1, { transform: numberAttribute });

  protected readonly lineIndexes = computed(() =>
    Array.from({ length: Math.max(1, Math.floor(this.lines())) }, (_, index) => index),
  );
}
```

`skeleton.html`:

```html
@if (variant() === 'text') { @for (index of lineIndexes(); track index) {
<span class="line shimmer"></span>
} } @else {
<span class="shape shimmer"></span>
}
```

`skeleton.scss`:

```scss
:host {
  display: flex;
  flex-direction: column;
  gap: var(--smart-space-sm);
}

.line {
  height: var(--smart-space-md);
  border-radius: var(--mat-sys-corner-extra-small);
}

.line:last-child:not(:first-child) {
  width: 60%;
}

.shape {
  height: var(--smart-size-skeleton-block);
  border-radius: var(--mat-sys-corner-medium);
}

:host([data-variant='circle']) .shape {
  width: var(--smart-size-icon-lg);
  height: var(--smart-size-icon-lg);
  border-radius: var(--mat-sys-corner-full);
}

.shimmer {
  display: block;
  background: var(--mat-sys-surface-container-highest);
  animation: pulse var(--smart-motion-duration-long) var(--smart-motion-easing-standard) infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.5;
  }
}

@media (prefers-reduced-motion: reduce) {
  .shimmer {
    animation: none;
  }
}
```

`public-api.ts` ergänzen:

```ts
export { UiCard, UiCardActions } from './lib/card/card';
export { UiEmptyState, UiEmptyStateActions } from './lib/empty-state/empty-state';
export { UiSkeleton } from './lib/skeleton/skeleton';
```

- [ ] **Step 3: Prüfen**

```bash
pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci
pnpm lint && pnpm --filter @smart/frontend typecheck
```

Expected: grün in beiden Themes. Erlaubt `mat-card-title` nicht die Attributform `[mat-card-title]` auf `h3`, die Überschrift als `<mat-card-title><h3 class="title">…</h3></mat-card-title>` schreiben (Ruling). Beanstandet Stylelint `max-width: 40ch` oder `opacity: 0.5`, die Werte als Tokens in `layout.css` anlegen (`--smart-size-text-measure: 40ch`, `--smart-opacity-pulse: 0.5`) und verwenden.

- [ ] **Step 4: Commit**

```bash
pnpm format
git add apps/frontend/projects/ui
git commit -m "feat(ui): add ui-card, ui-empty-state and ui-skeleton"
```

---

### Task 9: `ui-list` und `ui-list-item`

**Files:**

- Create: `apps/frontend/projects/ui/src/lib/list/list.ts`, `list.scss`, `list-item.ts`, `list-item.html`, `list-item.scss`, `list-item.spec.ts`, `list.stories.ts`
- Modify: `apps/frontend/projects/ui/src/public-api.ts`

**Interfaces:**

- Consumes: `UiIcon`, `IconName`, Story-Helfer; Angular Router (`RouterLink`).
- Produces: `UiList` (Rolle `list`, Inhalt: `ui-list-item`); `UiListItem` (`headline` required, `supporting?`, `icon?: IconName`, `trailingText?`, `route?: string`, `disabled: boolean`). Mit `route` und ohne `disabled` ist der Eintrag ein Link mit Chevron; mit `disabled` ist er nicht bedienbar, bleibt aber gut lesbar (Hinweis wie „kommt bald“ über `trailingText`).

- [ ] **Step 1: Failing tests**

`apps/frontend/projects/ui/src/lib/list/list-item.spec.ts`:

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { UiList } from './list';
import { UiListItem } from './list-item';

@Component({
  imports: [UiList, UiListItem],
  template: ` <ui-list>
    <ui-list-item
      icon="settings"
      headline="Einstellungen"
      supporting="Darstellung und Sprache"
      route="/mehr/einstellungen"
    />
    <ui-list-item
      icon="sensors"
      headline="Gateways"
      trailingText="kommt bald"
      route="/mehr/gateways"
      [disabled]="disabled()"
    />
  </ui-list>`,
})
class Host {
  readonly disabled = signal(true);
}

function render() {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture;
}

describe('UiListItem', () => {
  it('renders a list of list items', () => {
    const fixture = render();
    expect(fixture.nativeElement.querySelector('ui-list').getAttribute('role')).toBe('list');
    expect(fixture.nativeElement.querySelectorAll('[role="listitem"]')).toHaveLength(2);
  });

  it('links enabled entries to their route', () => {
    const fixture = render();
    const link = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/mehr/einstellungen');
    expect(link.textContent).toContain('Einstellungen');
    expect(link.textContent).toContain('Darstellung und Sprache');
  });

  it('renders disabled entries without a link', () => {
    const fixture = render();
    expect(fixture.nativeElement.querySelectorAll('a')).toHaveLength(1);
    const disabled = fixture.nativeElement.querySelector('[aria-disabled="true"]') as HTMLElement;
    expect(disabled.textContent).toContain('Gateways');
    expect(disabled.textContent).toContain('kommt bald');
  });

  it('becomes a link once enabled', () => {
    const fixture = render();
    fixture.componentInstance.disabled.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('a')).toHaveLength(2);
  });
});
```

`apps/frontend/projects/ui/src/lib/list/list.stories.ts`:

```ts
import { provideRouter } from '@angular/router';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, userEvent } from 'storybook/test';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../testing/story-helpers';
import { UiList } from './list';
import { UiListItem } from './list-item';

const meta: Meta<UiList> = {
  title: 'Inhalt/Liste',
  component: UiList,
  decorators: [
    applicationConfig({ providers: [provideRouter([])] }),
    moduleMetadata({ imports: [UiListItem] }),
  ],
};
export default meta;

const items = `
  <ui-list>
    <ui-list-item icon="palette" headline="Darstellung" supporting="Farben, Modus und Sprache" route="/darstellung" />
    <ui-list-item icon="notifications" headline="Benachrichtigungen" trailingText="kommt bald" disabled />
    <ui-list-item icon="sensors" headline="Gateways" route="/gateways" />
  </ui-list>`;

export const Mehr: StoryObj<UiList> = {
  render: () => ({ template: items }),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('listitem')).toHaveLength(3);
    await expect(canvas.getAllByRole('link')).toHaveLength(2);
    await userEvent.tab();
    await expect(canvas.getByRole('link', { name: /Darstellung/ })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('link', { name: /Gateways/ })).toHaveFocus();
    const focused = canvas.getByRole('link', { name: /Gateways/ });
    await expect(getComputedStyle(focused).outlineStyle).toBe('solid');
  },
};

export const Schmal: StoryObj<UiList> = {
  decorators: [withNarrowFrame],
  render: () => ({
    template: `<ui-list><ui-list-item icon="settings" headline="Benachrichtigungseinstellungsverwaltung" supporting="Donaudampfschifffahrtsgesellschaftskapitän" trailingText="kommt bald" disabled /></ui-list>`,
  }),
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};
```

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: FAIL – Module fehlen.

- [ ] **Step 2: Implementierung**

`apps/frontend/projects/ui/src/lib/list/list.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';

/** A list of `ui-list-item`s (M3 list); built without Material to keep roles and links simple. */
@Component({
  selector: 'ui-list',
  template: '<ng-content />',
  styleUrl: './list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'list' },
})
export class UiList {}
```

`list.scss`:

```scss
:host {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding-block: var(--smart-space-sm);
}
```

`apps/frontend/projects/ui/src/lib/list/list-item.ts`:

```ts
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiIcon } from '../icon/icon';
import type { IconName } from '../icon/icon-codepoints';

/** One entry of `ui-list`: a link when it has a route and is enabled, otherwise static text. */
@Component({
  selector: 'ui-list-item',
  imports: [NgTemplateOutlet, RouterLink, UiIcon],
  templateUrl: './list-item.html',
  styleUrl: './list-item.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'listitem' },
})
export class UiListItem {
  readonly headline = input.required<string>();
  readonly supporting = input<string>();
  readonly icon = input<IconName>();
  readonly trailingText = input<string>();
  readonly route = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });
}
```

`list-item.html`:

```html
@if (route() && !disabled()) {
<a class="row row--link" [routerLink]="route()">
  <ng-container [ngTemplateOutlet]="content" />
  <ui-icon class="chevron" name="chevron_right" />
</a>
} @else {
<div class="row" [attr.aria-disabled]="disabled() ? 'true' : null">
  <ng-container [ngTemplateOutlet]="content" />
</div>
}

<ng-template #content>
  @if (icon(); as icon) {
  <ui-icon class="leading" [name]="icon" />
  }
  <span class="texts">
    <span class="headline">{{ headline() }}</span>
    @if (supporting(); as supporting) {
    <span class="supporting">{{ supporting }}</span>
    }
  </span>
  @if (trailingText(); as trailingText) {
  <span class="trailing">{{ trailingText }}</span>
  }
</ng-template>
```

`list-item.scss`:

```scss
:host {
  display: block;
  min-width: 0;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--smart-space-lg);
  box-sizing: border-box;
  min-height: var(--smart-size-touch);
  padding: var(--smart-space-sm) var(--smart-space-lg);
  color: var(--mat-sys-on-surface);
  text-decoration: none;
}

.row--link {
  border-radius: var(--mat-sys-corner-medium);
  cursor: pointer;
  transition: background-color var(--smart-motion-duration-short)
    var(--smart-motion-easing-standard);
}

.row--link:hover {
  background: var(--mat-sys-surface-container-high);
}

.row--link:focus-visible {
  outline: var(--smart-focus-width) solid var(--mat-sys-primary);
  outline-offset: calc(var(--smart-focus-width) * -1);
}

.leading,
.chevron {
  color: var(--mat-sys-on-surface-variant);
}

.texts {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.headline {
  font: var(--mat-sys-body-large);
  overflow-wrap: anywhere;
  hyphens: auto;
}

.supporting,
.trailing {
  color: var(--mat-sys-on-surface-variant);
  font: var(--mat-sys-body-medium);
  overflow-wrap: anywhere;
}

.trailing {
  flex-shrink: 0;
  max-width: 40%;
  font: var(--mat-sys-label-medium);
  text-align: end;
}
```

`public-api.ts` ergänzen:

```ts
export { UiList } from './lib/list/list';
export { UiListItem } from './lib/list/list-item';
```

- [ ] **Step 3: Prüfen**

```bash
pnpm --filter @smart/frontend exec ng test ui --watch=false
pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci
pnpm lint && pnpm --filter @smart/frontend typecheck
```

Expected: grün in beiden Themes (axe prüft auch, dass der deaktivierte Eintrag lesbar bleibt). `40%` und `calc(... * -1)` sind erlaubt (keine verbotenen Einheiten).

- [ ] **Step 4: Commit**

```bash
pnpm format
git add apps/frontend/projects/ui
git commit -m "feat(ui): add ui-list and ui-list-item"
```

---

### Task 10: `ui-banner` und `UiSnackbar`

**Files:**

- Create: `apps/frontend/projects/ui/src/lib/banner/banner.ts`, `banner.html`, `banner.scss`, `banner.stories.ts`
- Create: `apps/frontend/projects/ui/src/lib/snackbar/snackbar.ts`, `snackbar.spec.ts`, `snackbar.stories.ts`
- Modify: `apps/frontend/projects/ui/src/public-api.ts`

**Interfaces:**

- Consumes: `UiIcon`, `IconName`, `UiButton` (Story), Story-Helfer.
- Produces: `UiBanner` (`tone: 'info' | 'warning' | 'offline' = 'info'`, `icon?: IconName` (Standard je Ton: `info`, `warning`, `cloud_off`), `heading?`, Text projiziert, Aktionen über `[uiBannerActions]`); `UiBannerActions`; `UiSnackbar` (Service, `show(message: string, options?: { action?: string; durationMs?: number }): Promise<'action' | 'dismissed'>`; ohne Aktion 4000 ms, mit Aktion ohne automatisches Schließen).

- [ ] **Step 1: Failing tests**

`apps/frontend/projects/ui/src/lib/snackbar/snackbar.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { MatSnackBar, type MatSnackBarConfig } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { UiSnackbar } from './snackbar';

class FakeSnackBar {
  readonly calls: { message: string; action?: string; config?: MatSnackBarConfig }[] = [];
  readonly dismissed = new Subject<{ dismissedByAction: boolean }>();
  open(message: string, action?: string, config?: MatSnackBarConfig) {
    this.calls.push({ message, action, config });
    return { afterDismissed: () => this.dismissed.asObservable() };
  }
}

function setup() {
  const fake = new FakeSnackBar();
  TestBed.configureTestingModule({ providers: [{ provide: MatSnackBar, useValue: fake }] });
  return { fake, snackbar: TestBed.inject(UiSnackbar) };
}

describe('UiSnackbar', () => {
  it('closes plain messages after four seconds, politely', () => {
    const { fake, snackbar } = setup();
    void snackbar.show('Gespeichert');
    expect(fake.calls[0]).toEqual({
      message: 'Gespeichert',
      action: undefined,
      config: { duration: 4000, politeness: 'polite' },
    });
  });

  it('keeps messages with an action open until the user reacts', () => {
    const { fake, snackbar } = setup();
    void snackbar.show('Raum gelöscht', { action: 'Rückgängig' });
    expect(fake.calls[0]!.config!.duration).toBeUndefined();
  });

  it('resolves with how the message was closed', async () => {
    const { fake, snackbar } = setup();
    const acted = snackbar.show('Raum gelöscht', { action: 'Rückgängig' });
    fake.dismissed.next({ dismissedByAction: true });
    await expect(acted).resolves.toBe('action');
    const ignored = snackbar.show('Gespeichert');
    fake.dismissed.next({ dismissedByAction: false });
    await expect(ignored).resolves.toBe('dismissed');
  });

  it('honours an explicit duration', () => {
    const { fake, snackbar } = setup();
    void snackbar.show('Gespeichert', { durationMs: 8000 });
    expect(fake.calls[0]!.config!.duration).toBe(8000);
  });
});
```

`apps/frontend/projects/ui/src/lib/snackbar/snackbar.stories.ts`:

```ts
import { Component, inject, signal } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { UiButton } from '../button/button';
import { UiSnackbar } from './snackbar';

@Component({
  selector: 'ui-snackbar-demo',
  imports: [UiButton],
  template: ` <ui-button (pressed)="show()">Raum löschen</ui-button>
    <p>Ergebnis: {{ result() }}</p>`,
})
class SnackbarDemo {
  private readonly snackbar = inject(UiSnackbar);
  protected readonly result = signal('–');
  protected async show(): Promise<void> {
    this.result.set(await this.snackbar.show('Raum gelöscht', { action: 'Rückgängig' }));
  }
}

const meta: Meta<SnackbarDemo> = { title: 'Rückmeldung/Snackbar', component: SnackbarDemo };
export default meta;

export const MitAktion: StoryObj<SnackbarDemo> = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Raum löschen' }));
    await expect(await screen.findByText('Raum gelöscht')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => expect(canvas.getByText('Ergebnis: action')).toBeVisible());
  },
};
```

`apps/frontend/projects/ui/src/lib/banner/banner.stories.ts`:

```ts
import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiButton } from '../button/button';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../testing/story-helpers';
import { UiBanner, UiBannerActions } from './banner';

const meta: Meta<UiBanner> = {
  title: 'Rückmeldung/Banner',
  component: UiBanner,
  decorators: [moduleMetadata({ imports: [UiBannerActions, UiButton] })],
};
export default meta;

export const Toene: StoryObj<UiBanner> = {
  render: () => ({
    template: `
      <div style="display: grid; gap: 16px; max-width: 560px">
        <ui-banner heading="Neu">Räume lassen sich jetzt sortieren.</ui-banner>
        <ui-banner tone="warning" heading="Batterie schwach">Der Sensor im Bad meldet 10 %.
          <div uiBannerActions><ui-button variant="text">Zum Gerät</ui-button></div>
        </ui-banner>
        <ui-banner tone="offline">Keine Verbindung. Änderungen werden gesendet, sobald du wieder online bist.</ui-banner>
      </div>`,
  }),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('status')).toHaveLength(3);
    await expect(canvas.getByRole('button', { name: 'Zum Gerät' })).toBeVisible();
  },
};

export const Schmal: StoryObj<UiBanner> = {
  decorators: [withNarrowFrame],
  render: () => ({
    template: `<ui-banner tone="warning" heading="Verbindungsunterbrechungsbenachrichtigung">Gatewaykommunikationsstörung</ui-banner>`,
  }),
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};
```

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: FAIL – Module fehlen.

- [ ] **Step 2: Implementierung**

`apps/frontend/projects/ui/src/lib/snackbar/snackbar.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

/** Plain messages close after this time; messages with an action stay until the user reacts (WCAG 2.2.1). */
const PLAIN_DURATION_MS = 4000;

/** Short, temporary feedback at the bottom of the screen. Texts come translated from the caller. */
@Injectable({ providedIn: 'root' })
export class UiSnackbar {
  private readonly snackBar = inject(MatSnackBar);

  show(
    message: string,
    options: { action?: string; durationMs?: number } = {},
  ): Promise<'action' | 'dismissed'> {
    const duration = options.durationMs ?? (options.action ? undefined : PLAIN_DURATION_MS);
    const ref = this.snackBar.open(message, options.action, { duration, politeness: 'polite' });
    return new Promise((resolve) => {
      ref
        .afterDismissed()
        .subscribe(({ dismissedByAction }) => resolve(dismissedByAction ? 'action' : 'dismissed'));
    });
  }
}
```

`apps/frontend/projects/ui/src/lib/banner/banner.ts`:

```ts
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  computed,
  contentChild,
  input,
} from '@angular/core';
import { UiIcon } from '../icon/icon';
import type { IconName } from '../icon/icon-codepoints';

/** Marks the element holding a banner's actions. */
@Directive({ selector: '[uiBannerActions]' })
export class UiBannerActions {}

export type UiBannerTone = 'info' | 'warning' | 'offline';

const DEFAULT_ICON: Record<UiBannerTone, IconName> = {
  info: 'info',
  warning: 'warning',
  offline: 'cloud_off',
};

/** Prominent, persistent message at the top of content (M3 banner); announced politely. */
@Component({
  selector: 'ui-banner',
  imports: [UiIcon],
  templateUrl: './banner.html',
  styleUrl: './banner.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', '[attr.data-tone]': 'tone()' },
})
export class UiBanner {
  readonly tone = input<UiBannerTone>('info');
  readonly icon = input<IconName>();
  readonly heading = input<string>();

  protected readonly actions = contentChild(UiBannerActions);
  protected readonly shownIcon = computed(() => this.icon() ?? DEFAULT_ICON[this.tone()]);
}
```

`banner.html`:

```html
<ui-icon class="icon" [name]="shownIcon()" />
<div class="body">
  @if (heading(); as heading) {
  <p class="heading">{{ heading }}</p>
  }
  <div class="text"><ng-content /></div>
  @if (actions()) {
  <div class="actions"><ng-content select="[uiBannerActions]" /></div>
  }
</div>
```

`banner.scss`:

```scss
:host {
  display: flex;
  align-items: flex-start;
  gap: var(--smart-space-md);
  min-width: 0;
  padding: var(--smart-space-md) var(--smart-space-lg);
  border-radius: var(--mat-sys-corner-medium);
}

:host([data-tone='info']) {
  background: var(--mat-sys-secondary-container);
  color: var(--mat-sys-on-secondary-container);
}

:host([data-tone='warning']) {
  background: var(--smart-status-warning-container);
  color: var(--smart-status-on-warning-container);
}

:host([data-tone='offline']) {
  background: var(--smart-status-offline-container);
  color: var(--smart-status-on-offline-container);
}

.icon {
  margin-top: var(--smart-space-xs);
}

.body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--smart-space-xs);
  min-width: 0;
}

.heading {
  margin: 0;
  font: var(--mat-sys-title-small);
  overflow-wrap: anywhere;
  hyphens: auto;
}

.text {
  font: var(--mat-sys-body-medium);
  overflow-wrap: anywhere;
  hyphens: auto;
}

.actions {
  display: flex;
  justify-content: flex-end;
}
```

`public-api.ts` ergänzen:

```ts
export { UiBanner, UiBannerActions, type UiBannerTone } from './lib/banner/banner';
export { UiSnackbar } from './lib/snackbar/snackbar';
```

- [ ] **Step 3: Prüfen**

```bash
pnpm --filter @smart/frontend exec ng test ui --watch=false
pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci
pnpm lint && pnpm --filter @smart/frontend typecheck
```

Expected: grün. Die Snackbar liegt in Materials Overlay außerhalb von `#storybook-root`; axe prüft dort nur die Story-Fläche – das ist beabsichtigt, die Snackbar-Farben sind Materials eigene Rollen (`inverse-surface`), die die Kontrastmatrix aus 3a abdeckt.

- [ ] **Step 4: Commit**

```bash
pnpm format
git add apps/frontend/projects/ui
git commit -m "feat(ui): add ui-banner and the snackbar service"
```

---

### Task 11: Zeit-Pipes `uiDateTime` und `uiRelativeTime`

**Files:**

- Create: `apps/frontend/projects/ui/src/lib/time/format-context.ts`, `clock.ts`, `formatters.ts`, `date-time.pipe.ts`, `relative-time.pipe.ts`
- Create: `apps/frontend/projects/ui/src/lib/time/formatters.spec.ts`, `time-pipes.spec.ts`, `time.stories.ts`
- Modify: `apps/frontend/projects/ui/src/public-api.ts`

**Interfaces:**

- Consumes: `utcInstantSchema` (`@smart/contracts`).
- Produces: `UiFormatContext` (Service, `locale: WritableSignal<string>` Standard `'de'`, `timeZone: WritableSignal<string>` Standard = Zeitzone des Browsers; 3c setzt die Sprache, Etappe 4 die Haushalts-Zeitzone); `UiClock` (Service, `now: Signal<number>`, tickt alle 30 s); reine Funktionen `formatDateTime(value, style, locale, timeZone): string` und `formatRelativeTime(value, now, locale, timeZone): string`; Pipes `uiDateTime` (`value | uiDateTime: 'short' | 'medium' | 'date' | 'time'`, Standard `medium`) und `uiRelativeTime`; Typ `UiDateTimeStyle`.

- [ ] **Step 1: Failing tests – Formatierung**

`apps/frontend/projects/ui/src/lib/time/formatters.spec.ts`:

```ts
import { formatDateTime, formatRelativeTime } from './formatters';

const BERLIN = 'Europe/Berlin';

describe('formatDateTime', () => {
  it('shows the household time, not the browser time', () => {
    expect(formatDateTime('2026-10-11T12:00:00Z', 'medium', 'de', BERLIN)).toBe(
      '11.10.2026, 14:00',
    );
    expect(formatDateTime('2026-10-11T12:00:00Z', 'medium', 'de', 'Pacific/Chatham')).toBe(
      '12.10.2026, 01:45',
    );
  });

  it('handles the spring gap and the autumn repeat in Berlin', () => {
    expect(formatDateTime('2026-03-29T00:30:00Z', 'time', 'de', BERLIN)).toBe('01:30');
    expect(formatDateTime('2026-03-29T01:30:00Z', 'time', 'de', BERLIN)).toBe('03:30');
    expect(formatDateTime('2026-10-25T00:30:00Z', 'time', 'de', BERLIN)).toBe('02:30');
    expect(formatDateTime('2026-10-25T01:30:00Z', 'time', 'de', BERLIN)).toBe('02:30');
  });

  it('offers short, date and time styles and follows the locale', () => {
    expect(formatDateTime('2026-10-11T12:00:00Z', 'short', 'de', BERLIN)).toBe('11.10.26, 14:00');
    expect(formatDateTime('2026-10-11T12:00:00Z', 'date', 'de', BERLIN)).toBe('11.10.2026');
    expect(formatDateTime('2026-10-11T12:00:00Z', 'medium', 'en', BERLIN)).toMatch(
      /^Oct 11, 2026, 2:00\sPM$/,
    );
  });

  it.each(['', 'gestern', '2026-10-11 12:00', '2026-10-11T12:00:00', '2026-10-11T14:00:00+02:00'])(
    'returns an empty string for %j (only UTC with Z is valid)',
    (value) => {
      expect(formatDateTime(value, 'medium', 'de', BERLIN)).toBe('');
    },
  );

  it('returns an empty string for null and undefined', () => {
    expect(formatDateTime(null, 'medium', 'de', BERLIN)).toBe('');
    expect(formatDateTime(undefined, 'medium', 'de', BERLIN)).toBe('');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it.each([
    [10, 'jetzt'],
    [50, 'vor 1 Minute'],
    [5 * 60, 'vor 5 Minuten'],
    [3 * 3600, 'vor 3 Stunden'],
  ])('%i seconds ago is %j', (seconds, expected) => {
    expect(formatRelativeTime(ago(seconds), now, 'de', BERLIN)).toBe(expected);
  });

  it('uses calendar days in the household time zone', () => {
    // 12:00Z = 14:00 in Berlin; 23 hours earlier is 15:00 the day before → "gestern".
    expect(formatRelativeTime(ago(23 * 3600), now, 'de', BERLIN)).toBe('gestern');
    expect(formatRelativeTime(ago(2 * 86400), now, 'de', BERLIN)).toBe('vorgestern');
    expect(formatRelativeTime(ago(4 * 86400), now, 'de', BERLIN)).toBe('vor 4 Tagen');
  });

  it('switches to weeks, months and years', () => {
    expect(formatRelativeTime(ago(14 * 86400), now, 'de', BERLIN)).toBe('vor 2 Wochen');
    expect(formatRelativeTime(ago(90 * 86400), now, 'de', BERLIN)).toBe('vor 3 Monaten');
    expect(formatRelativeTime(ago(400 * 86400), now, 'de', BERLIN)).toBe('letztes Jahr');
  });

  it('describes the future too and follows the locale', () => {
    expect(formatRelativeTime(new Date(now + 5 * 60 * 1000).toISOString(), now, 'de', BERLIN)).toBe(
      'in 5 Minuten',
    );
    expect(formatRelativeTime(ago(5 * 60), now, 'en', BERLIN)).toBe('5 minutes ago');
  });

  it('returns an empty string for invalid values', () => {
    expect(formatRelativeTime('2026-10-11T12:00:00', now, 'de', BERLIN)).toBe('');
    expect(formatRelativeTime(null, now, 'de', BERLIN)).toBe('');
  });
});
```

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: FAIL – `Cannot find module './formatters'`.

- [ ] **Step 2: Formatierung umsetzen**

`apps/frontend/projects/ui/src/lib/time/formatters.ts`:

```ts
import { utcInstantSchema } from '@smart/contracts';

export type UiDateTimeStyle = 'short' | 'medium' | 'date' | 'time';

const STYLE_OPTIONS: Record<UiDateTimeStyle, Intl.DateTimeFormatOptions> = {
  short: { dateStyle: 'short', timeStyle: 'short' },
  medium: { dateStyle: 'medium', timeStyle: 'short' },
  date: { dateStyle: 'medium' },
  time: { timeStyle: 'short' },
};

const cache = new Map<string, Intl.DateTimeFormat | Intl.RelativeTimeFormat>();

function dateFormat(
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `d|${locale}|${timeZone}|${JSON.stringify(options)}`;
  let format = cache.get(key) as Intl.DateTimeFormat | undefined;
  if (!format) cache.set(key, (format = new Intl.DateTimeFormat(locale, { ...options, timeZone })));
  return format;
}

function relativeFormat(locale: string): Intl.RelativeTimeFormat {
  const key = `r|${locale}`;
  let format = cache.get(key) as Intl.RelativeTimeFormat | undefined;
  if (!format) cache.set(key, (format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })));
  return format;
}

/** Milliseconds since epoch for a valid UTC instant (`…Z`), otherwise null. */
function parseInstant(value: string | null | undefined): number | null {
  if (value == null || !utcInstantSchema.safeParse(value).success) return null;
  return Date.parse(value);
}

export function formatDateTime(
  value: string | null | undefined,
  style: UiDateTimeStyle,
  locale: string,
  timeZone: string,
): string {
  const instant = parseInstant(value);
  return instant === null ? '' : dateFormat(locale, timeZone, STYLE_OPTIONS[style]).format(instant);
}

/** Calendar day number of an instant in the given time zone (days since 1970-01-01 there). */
function dayNumber(instant: number, timeZone: string): number {
  const parts = dateFormat('en-US', timeZone, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000;
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;

export function formatRelativeTime(
  value: string | null | undefined,
  now: number,
  locale: string,
  timeZone: string,
): string {
  const instant = parseInstant(value);
  if (instant === null) return '';
  const format = relativeFormat(locale);
  const seconds = (instant - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 45) return format.format(0, 'second');
  if (abs < 45 * MINUTE) return format.format(Math.round(seconds / MINUTE), 'minute');
  if (abs < 22 * HOUR) return format.format(Math.round(seconds / HOUR), 'hour');
  const days = dayNumber(instant, timeZone) - dayNumber(now, timeZone);
  if (Math.abs(days) < 7) return format.format(days, 'day');
  if (abs < 30 * DAY) return format.format(Math.round(seconds / (7 * DAY)), 'week');
  if (abs < 365 * DAY) return format.format(Math.round(seconds / (30.436875 * DAY)), 'month');
  return format.format(Math.round(seconds / (365.2425 * DAY)), 'year');
}
```

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: Formatierungstests PASS. Liefert die ICU-Version andere Zeichen (z. B. schmales Leerzeichen vor „PM“ – deshalb `\s` im Test), nur die Testerwartung des Englisch-Falls an die tatsächliche ICU-Ausgabe anpassen; deutsche Erwartungen sind fest.

- [ ] **Step 3: Failing tests – Pipes, Kontext, Uhr**

`apps/frontend/projects/ui/src/lib/time/time-pipes.spec.ts`:

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiClock } from './clock';
import { UiDateTimePipe } from './date-time.pipe';
import { UiFormatContext } from './format-context';
import { UiRelativeTimePipe } from './relative-time.pipe';

@Component({
  imports: [UiDateTimePipe, UiRelativeTimePipe],
  template: `<span id="abs">{{ at | uiDateTime }}</span
    ><span id="rel">{{ at | uiRelativeTime }}</span>`,
})
class Host {
  readonly at = '2026-10-11T12:00:00Z';
}

function setup() {
  const now = signal(Date.parse('2026-10-11T12:05:00Z'));
  TestBed.configureTestingModule({ providers: [{ provide: UiClock, useValue: { now } }] });
  const context = TestBed.inject(UiFormatContext);
  context.locale.set('de');
  context.timeZone.set('Europe/Berlin');
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const text = (id: string) =>
    (fixture.nativeElement.querySelector(`#${id}`) as HTMLElement).textContent;
  return { fixture, now, context, text };
}

describe('time pipes', () => {
  it('format in the context time zone and locale', () => {
    const { text } = setup();
    expect(text('abs')).toBe('11.10.2026, 14:00');
    expect(text('rel')).toBe('vor 5 Minuten');
  });

  it('follow changes of time zone and locale', () => {
    const { fixture, context, text } = setup();
    context.timeZone.set('Pacific/Chatham');
    context.locale.set('en');
    fixture.detectChanges();
    expect(text('abs')).toMatch(/^Oct 12, 2026, 1:45\sAM$/);
    expect(text('rel')).toBe('5 minutes ago');
  });

  it('update the relative time as the clock ticks', () => {
    const { fixture, now, text } = setup();
    now.set(Date.parse('2026-10-11T15:00:00Z'));
    fixture.detectChanges();
    expect(text('rel')).toBe('vor 3 Stunden');
  });
});
```

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: FAIL – Module `./clock`, `./date-time.pipe` fehlen.

- [ ] **Step 4: Pipes, Kontext und Uhr umsetzen**

`apps/frontend/projects/ui/src/lib/time/format-context.ts`:

```ts
import { Injectable, signal } from '@angular/core';

/**
 * Language and time zone for all formatting in @smart/ui. Stage 3c sets the language, stage 4 the
 * household time zone; until then the browser's time zone is used.
 */
@Injectable({ providedIn: 'root' })
export class UiFormatContext {
  readonly locale = signal('de');
  readonly timeZone = signal(Intl.DateTimeFormat().resolvedOptions().timeZone);
}
```

`apps/frontend/projects/ui/src/lib/time/clock.ts`:

```ts
import { DestroyRef, Injectable, inject, signal, type Signal } from '@angular/core';

const TICK_MS = 30_000;

/** Current time as a signal, so relative times update by themselves. */
@Injectable({ providedIn: 'root' })
export class UiClock {
  private readonly current = signal(Date.now());
  readonly now: Signal<number> = this.current.asReadonly();

  constructor() {
    const timer = setInterval(() => this.current.set(Date.now()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
```

`apps/frontend/projects/ui/src/lib/time/date-time.pipe.ts`:

```ts
import { Pipe, inject, type PipeTransform } from '@angular/core';
import { UiFormatContext } from './format-context';
import { formatDateTime, type UiDateTimeStyle } from './formatters';

/** `instant | uiDateTime: 'medium'` – UTC instant shown in the household time zone (spec §9). */
@Pipe({ name: 'uiDateTime', pure: false })
export class UiDateTimePipe implements PipeTransform {
  private readonly context = inject(UiFormatContext);

  transform(value: string | null | undefined, style: UiDateTimeStyle = 'medium'): string {
    return formatDateTime(value, style, this.context.locale(), this.context.timeZone());
  }
}
```

`apps/frontend/projects/ui/src/lib/time/relative-time.pipe.ts`:

```ts
import { Pipe, inject, type PipeTransform } from '@angular/core';
import { UiClock } from './clock';
import { UiFormatContext } from './format-context';
import { formatRelativeTime } from './formatters';

/** `instant | uiRelativeTime` – "vor 5 Minuten", "gestern"; updates as the clock ticks. */
@Pipe({ name: 'uiRelativeTime', pure: false })
export class UiRelativeTimePipe implements PipeTransform {
  private readonly context = inject(UiFormatContext);
  private readonly clock = inject(UiClock);

  transform(value: string | null | undefined): string {
    return formatRelativeTime(
      value,
      this.clock.now(),
      this.context.locale(),
      this.context.timeZone(),
    );
  }
}
```

(Die Pipes lesen Signale; in der zonenlosen App werden die Templates dadurch bei Änderungen von Sprache, Zeitzone und Uhr neu gerendert. `pure: false`, weil sich das Ergebnis ohne Änderung der Argumente ändert.)

`public-api.ts` ergänzen:

```ts
export { UiClock } from './lib/time/clock';
export { UiDateTimePipe } from './lib/time/date-time.pipe';
export { UiFormatContext } from './lib/time/format-context';
export type { UiDateTimeStyle } from './lib/time/formatters';
export { UiRelativeTimePipe } from './lib/time/relative-time.pipe';
```

- [ ] **Step 5: Story**

`apps/frontend/projects/ui/src/lib/time/time.stories.ts`:

```ts
import { Component, inject } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiDateTimePipe } from './date-time.pipe';
import { UiFormatContext } from './format-context';
import { UiRelativeTimePipe } from './relative-time.pipe';

@Component({
  selector: 'ui-time-demo',
  imports: [UiDateTimePipe, UiRelativeTimePipe],
  template: ` <dl>
    <dt>Mittel</dt>
    <dd data-testid="medium">{{ at | uiDateTime }}</dd>
    <dt>Kurz</dt>
    <dd>{{ at | uiDateTime: 'short' }}</dd>
    <dt>Datum</dt>
    <dd>{{ at | uiDateTime: 'date' }}</dd>
    <dt>Uhrzeit</dt>
    <dd>{{ at | uiDateTime: 'time' }}</dd>
    <dt>Relativ</dt>
    <dd>{{ recent | uiRelativeTime }}</dd>
  </dl>`,
})
class TimeDemo {
  protected readonly at = '2026-10-25T01:30:00Z';
  protected readonly recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  constructor() {
    const context = inject(UiFormatContext);
    context.locale.set('de');
    context.timeZone.set('Europe/Berlin');
  }
}

const meta: Meta<TimeDemo> = { title: 'Inhalt/Zeitangaben', component: TimeDemo };
export default meta;

export const Berlin: StoryObj<TimeDemo> = {
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('medium')).toHaveTextContent('25.10.2026, 02:30');
    await expect(canvas.getByText('vor 5 Minuten')).toBeVisible();
  },
};
```

- [ ] **Step 6: Prüfen**

```bash
pnpm --filter @smart/frontend exec ng test ui --watch=false
TZ=Pacific/Chatham pnpm --filter @smart/frontend exec ng test ui --watch=false
pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci
pnpm lint && pnpm --filter @smart/frontend typecheck
```

Expected: alle Tests grün, auch mit `TZ=Pacific/Chatham` (Ergebnisse hängen nur von der Kontext-Zeitzone ab, nicht von der des Rechners).

- [ ] **Step 7: Commit**

```bash
pnpm format
git add apps/frontend/projects/ui
git commit -m "feat(ui): add time-zone-aware date and relative time pipes"
```

---

### Task 12: Dokumentation und Abschlussprüfung

**Files:**

- Create: `apps/frontend/projects/ui/src/lib/einfuehrung.mdx`
- Modify: `apps/frontend/.storybook/main.ts`, `apps/frontend/projects/ui/README.md`, `CLAUDE.md`

**Interfaces:**

- Consumes: alle Komponenten, `pnpm icons:build`.
- Produces: Storybook-Seite „Einführung“; aktualisierte README.

- [ ] **Step 1: Storybook-Einführung**

`apps/frontend/.storybook/main.ts`: `stories` → `['../projects/ui/src/**/*.mdx', '../projects/ui/src/**/*.stories.ts']`.

`apps/frontend/projects/ui/src/lib/einfuehrung.mdx`:

```mdx
import { Meta } from '@storybook/addon-docs/blocks';

<Meta title="Einführung" />

# @smart/ui

Alle Oberflächen der Smart-Home-App entstehen ausschließlich aus diesen Bausteinen. Die Werkzeugleiste oben stellt Grundfarbe, Variante, Modus, Kontrast, Formen und Schrift um – genau wie das Theme in der App.

## Regeln

- **Nur über `@smart/ui`:** Features importieren keine Angular-Material- oder CDK-Bausteine und haben kein eigenes CSS. Fehlt etwas, entsteht eine neue `ui-*`-Komponente.
- **Nur Tokens:** Farben, Abstände, Größen und Zeiten kommen aus `--mat-sys-*` und `--smart-*`.
- **Kein Text in Komponenten:** Beschriftungen, Hinweise und Fehlermeldungen übergibt der Aufrufer (übersetzt).
- **Zeit:** Zeitstempel sind UTC mit `Z`; angezeigt wird mit `uiDateTime` und `uiRelativeTime` in der Haushalts-Zeitzone.
- **Barrierefreiheit:** Jede Story wird mit axe (WCAG 2.2 AA) im Standard-Theme und dunkel mit hohem Kontrast geprüft; jede Komponente ist per Tastatur bedienbar.

## Symbole

Verfügbar sind nur die Symbole aus `lib/icon/icons.json` (Material Symbols Rounded). Neues Symbol: Namen dort alphabetisch eintragen und `pnpm icons:build` ausführen – das erzeugt die Schrift-Teilmenge und den Typ `IconName` neu.
```

- [ ] **Step 2: README und CLAUDE.md**

`apps/frontend/projects/ui/README.md` um einen Abschnitt ergänzen:

```markdown
## Bausteine

| Gruppe      | Komponenten                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------- |
| Layout      | `ui-page`, `ui-section`, `ui-stack`, `ui-grid`                                                     |
| Bedienung   | `ui-button`, `ui-icon-button`, `ui-switch`, `ui-segmented-button`, `ui-chip-set`, `ui-color-field` |
| Inhalt      | `ui-card`, `ui-list`, `ui-list-item`, `ui-empty-state`, `ui-skeleton`, `ui-icon`                   |
| Formular    | `ui-text-field`                                                                                    |
| Rückmeldung | `ui-banner`, `UiSnackbar` (Service)                                                                |
| Zeit        | `uiDateTime`, `uiRelativeTime`, `UiFormatContext`                                                  |

Neues Symbol: Namen in `src/lib/icon/icons.json` eintragen, dann `pnpm icons:build`.
```

`CLAUDE.md`, Befehlstabelle: Zeile `| Symbol-Schrift neu erzeugen | `pnpm icons:build` |` ergänzen.

- [ ] **Step 3: Abschlussprüfung**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:tz && pnpm build
pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci
pnpm licenses:check
sh infra/compose/test/stack-test.sh
```

Expected: alles grün; im Build-Log `Initial total` unter 500 kB; Test-Runner meldet für jede Story zwei axe-Durchläufe ohne Verstöße; Stack-Test `OK: stack test passed`.

- [ ] **Step 4: Commit**

```bash
pnpm format
git add apps/frontend CLAUDE.md
git commit -m "docs(ui): document the component library in Storybook and the README"
```
