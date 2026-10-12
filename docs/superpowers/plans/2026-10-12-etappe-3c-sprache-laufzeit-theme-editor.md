# Etappe 3c: Sprache, Laufzeitkonfiguration und Theme-Editor – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die App spricht Deutsch und Englisch (Transloco, CI-geprüfte Schlüssel), liest ihre Laufzeitkonfiguration aus `config.json`, das Theme folgt der festgelegten Vorrangregel und funktioniert über Tabs und Kontraststufen hinweg, und `@smart/ui` bietet den Theme-Editor (persönlich und Installation) – alles in Storybook mit Sprach- und Theme-Werkzeugleiste über denselben `ThemeService`.

**Architecture:** Transloco läuft in der App (`core/i18n`); `@smart/ui` bringt eigene Übersetzungsdateien mit (Schlüssel `ui.*`), die beim Laden in die Wurzelübersetzung der App bzw. von Storybook gemischt werden. Zwei Prüfungen halten Texte sauber: eine ESLint-Template-Regel verbietet sichtbaren Text ohne Schlüssel, `pnpm i18n:check` (Transloco Keys Manager) findet fehlende und ungenutzte Schlüssel. Die Laufzeitkonfiguration schreibt der `web`-Container beim Start aus `SMART_*`-Umgebungsvariablen nach `/config.json`; `main.ts` lädt sie vor dem Bootstrap. Der Theme-Editor ist eine reine Eingabekomponente (`model()`-Bindungen), die Seite in 3d verbindet ihn mit dem `ThemeService`.

**Tech Stack:** Angular 22.2 (Standalone, Signals, Zoneless, OnPush), Angular Material/CDK 22.2.2, `@jsverse/transloco` 8.4.0 (MIT), `@jsverse/transloco-keys-manager` 8.1.1 (MIT), Storybook 10.6.1, Vitest 5, Playwright 1.64.0, nginx-unprivileged 1.31.6.

**Spec:** `docs/superpowers/specs/2026-10-11-etappe-3-design-system-design.md` (Abschnitte 2, 4.4, 4.5, 5, 7, 9, 10) und Architektur-Spec `docs/superpowers/specs/2026-10-11-smart-home-architecture-design.md` (Abschnitte 10.3, 10.5, 10.9). Übertrag aus `docs/superpowers/plans/2026-10-11-etappe-3a-theme-fundament.md` und `docs/superpowers/plans/2026-10-11-etappe-3b-komponenten.md`, jeweils Abschnitt „Ergebnis und Übertrag → Übertrag in Plan 3c“.

**Abgrenzung (Aufteilung von 3c):** Der frühere Plan „3c“ ist in zwei Pläne geteilt, weil er sonst rund doppelt so groß wie 3b würde.

- **3c (dieser Plan):** Sprache, Laufzeitkonfiguration, offene Theme-Punkte aus 3a, Storybook-Werkzeugleiste, `ui-select`, `ui-theme-editor`.
- **3d (nächster Plan):** `ui-adaptive-shell`, `ui-top-app-bar`, `ui-badge`, App-Rahmen, Routen und Seiten (einschließlich der Einstellungsseiten, die den Editor einbinden), `provideFeature()`, PWA (Manifest, Service Worker, Offline-/Update-Banner), App-Icon, Playwright-Smoke für Navigation, Theme-Persistenz und Sprachwechsel. Dazu die 3b-Überträge zu Snackbar, Banner, Überschriftenebenen, Umbruch, Button-Link-Modus und Liste.

**Bewusste Abweichungen von der Spec:**

- **`ui-select` (neu):** Spec 5 nennt kein Auswahlfeld; die Architektur-Spec 10.2 führt `ui-select`. Der Theme-Editor braucht es: Bei 288 px Inhaltsbreite (320-px-Handy minus Seitenrand) brechen Segmented Buttons mit vier und mehr Optionen Wörter mitten im Wort um (Übertrag 3b). Variante, Kontrast, Formen und Schrift sind deshalb Auswahlfelder, nur der Modus (drei kurze Optionen) bleibt ein Segmented Button.
- **Texte in `@smart/ui`:** In 3b galt „jeder Text kommt per Input“. Der Theme-Editor hat rund 40 eigene Texte; sie kommen aus den Übersetzungsdateien der Bibliothek (`ui.*`). Einfache Komponenten (Button, Feld, Liste …) nehmen ihre Texte weiterhin per Input.
- **Vorrang des Instanz-Themes (Spec 4.5, Übertrag 3a):** im Browser gespeicherte Instanz nur, solange `features.instanceAppearanceEditor` aktiv ist; sonst `config.json`; sonst Build-Default. Task 5 trägt das in Spec 4.5 ein.
- **Boot-Cache und geänderter Instanz-Default:** `theme-boot.js` läuft vor dem Laden von `config.json` und kann einen geänderten Instanz-Default nicht erkennen; nach einer Änderung durch den Hoster zeigt der erste Seitenaufruf einmal kurz das alte Theme. Der Cache bekommt eine Formatversion und beide Kontraststufen (Task 3), aber keine Instanzkennung.

## Global Constraints

- Node 24.21.0, pnpm 12.11.2, TypeScript 6.0.3, Angular 22.2.x, Angular Material/CDK 22.2.2 – wie bisher.
- Neue Pakete exakt: `@jsverse/transloco@8.4.0` (Frontend, Abhängigkeit), `@jsverse/transloco-keys-manager@8.1.1` (in `tools/lint-config` als Abhängigkeit, im Frontend als Dev-Abhängigkeit für `marker`).
- Sprachen genau `de` und `en`; Rückfall und Standard `de` (Spec 7). Liste und Typ kommen aus `@smart/contracts` (`LANGUAGES`, `Language`).
- **Kein sichtbarer Text ohne Übersetzungsschlüssel** (Spec 7): In Templates von App und `@smart/ui` stehen keine Buchstaben als Text und keine wörtlichen Werte in Text-Attributen (`aria-label`, `label`, `heading` …). Erzwungen durch `smart/no-literal-template-text` (Task 1). Stories, Specs und `testing/` sind ausgenommen und dürfen deutsche Beispieltexte verwenden.
- Übersetzungsschlüssel: App-Schlüssel in `apps/frontend/src/i18n/{de,en}.json`, Bibliotheksschlüssel unter `ui.*` in `apps/frontend/projects/ui/src/i18n/{de,en}.json`, verschachtelt (nicht flach). Dynamisch gewählte Schlüssel werden mit `marker('…')` aus `@jsverse/transloco-keys-manager/marker` markiert, sonst meldet `pnpm i18n:check` sie als ungenutzt.
- Komponenten wie in 3b: Standalone, `ChangeDetectionStrategy.OnPush`, Signal-APIs, Selektor-Präfix `ui-`, Klassen-Präfix `Ui`, Dateinamen ohne Suffix; Styles nur per `styleUrl` in `@smart/ui`; feste Längen/Farben/Zeiten nur in `lib/tokens/`; Material-Anpassungen nur über `mat.*-overrides`; Exporte nur über `public-api.ts`.
- Interaktive Elemente: Zielfläche mindestens 48 × 48 px, sichtbarer Fokus, vollständig per Tastatur bedienbar. Jede neue Komponente hat Story mit `play`-Funktion; axe läuft in jeder Story zweimal (Standard; dunkel, hoher Kontrast, Bernstein, **Englisch** – Task 4).
- Speicherzugriffe im Browser (`localStorage`) immer in `try/catch`; die App startet auch mit gesperrtem oder kaputtem Speicher.
- Laufzeitkonfiguration: Umgebungsvariablen `SMART_INSTANCE_APPEARANCE_EDITOR` (`true` schaltet ein, alles andere aus) und `SMART_INSTANCE_APPEARANCE` (JSON nach `instanceAppearanceSchema`, optional). Ausgeliefert als `/config.json` mit `Cache-Control: no-store`.
- Bundle-Budget unverändert: initiales JavaScript < 500 kB (Fehler im Build).
- Code, Kommentare, Commits Englisch; Doku Deutsch; Conventional Commits mit Scope (`ui`, `contracts`, `frontend`, `lint`, `infra`, `docs`, `deps`), **ohne KI-Attribution**.
- Arbeit auf Branch `feat/etappe-3c-sprache-theme-editor` (von `main` abgezweigt, enthält diesen Plan).
- Befehle: vor jedem pnpm/node/ng-Aufruf `eval "$(fnm env --shell bash)" && fnm use 24.21.0`. Nach Änderungen an `packages/*`: `pnpm packages:build`.
- **Prüfung am Ende jeder Task** (zusätzlich zu den Task-Schritten): `pnpm lint && pnpm typecheck && pnpm --filter @smart/frontend test && pnpm --filter @smart/frontend build`. Der App-Build prüft Templates strenger als Storybook (Lehre aus 3b). Tasks, die Stories ändern, zusätzlich `pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci`; Tasks, die nginx, Container oder E2E ändern, zusätzlich `sh infra/compose/test/stack-test.sh` (Docker nötig).

## Review Focus

1. **Kaputter, gesperrter oder geteilter Browser-Speicher:** gesperrtes `localStorage`, ungültiges JSON, gespeicherte persönliche Farben in altem Format, Änderung in einem zweiten Tab. Erwartung: App startet, gültige Teile (Modus, Kontrast) bleiben, beide Tabs zeigen dasselbe. → Tests in Task 3.
2. **`config.json` fehlt, ist langsam, kein JSON oder enthält ein ungültiges Theme:** App startet mit Build-Default; ein ungültiges Theme schaltet den Editor-Schalter nicht mit ab. → Tests in Task 5 (Loader und Parser) und Stack-Test.
3. **Browsersprachen:** `en-GB`, `de-AT`, nicht unterstützte (`fr`), leere Liste, gespeicherter Unsinn. Erwartung: passende Sprache, sonst Deutsch; `<html lang>` stimmt. → Tests in Task 2 und Stack-Test.
4. **Schmalstes Handy (288 px Inhaltsbreite) und lange englische Texte:** Theme-Editor ohne waagerechtes Scrollen und ohne Wortbrüche mitten im Wort. → Story „Schmal“ in Task 9 (läuft im zweiten Durchlauf auf Englisch).
5. **Editor-Eingaben am Rand:** ungültiges Hex beim Tippen, Override gleich dem abgeleiteten Wert, Farbtreue mit vorhandenen Overrides umschalten, graue Overrides. Erwartung: kein Absturz, Werte bleiben konsistent, Grau bleibt grau. → Tests in Task 3 (Engine) und Task 8.

## Dateiübersicht

| Bereich       | Dateien                                                                                                                                                              | Task    |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Lint          | `tools/lint-config/eslint/rules/no-literal-template-text.mjs`, `tools/lint-config/i18n/check-translation-keys.mjs`, Tests                                            | 1       |
| Übersetzungen | `apps/frontend/transloco.config.cjs`, `apps/frontend/src/i18n/*.json`, `apps/frontend/projects/ui/transloco.config.cjs`, `apps/frontend/projects/ui/src/i18n/*.json` | 1, 8, 9 |
| Contracts     | `packages/contracts/src/language.ts`, `packages/contracts/src/runtime-config.ts`                                                                                     | 2, 5    |
| App-Kern      | `apps/frontend/src/app/core/i18n/*`, `apps/frontend/src/app/core/config/*`, `app.config.ts`, `main.ts`, `index.html`                                                 | 2, 5    |
| Theme         | `packages/theme/src/scheme.ts`, `projects/ui/src/lib/theme/*`, `public/theme-boot.js`                                                                                | 3       |
| Storybook     | `.storybook/preview.ts`, `.storybook/test-runner.ts`, `projects/ui/src/lib/testing/storybook-environment.ts`                                                         | 4       |
| Container     | `apps/frontend/nginx/*`, `apps/frontend/Dockerfile`, `infra/compose/*`, `tests/e2e/specs/stack-smoke.spec.ts`                                                        | 2, 3, 5 |
| Komponenten   | `projects/ui/src/lib/{option.ts,chip-set,color-field,card,empty-state,form-field,select,theme-editor}`                                                               | 6–9     |
| Doku          | `CLAUDE.md`, `projects/ui/README.md`, `docs/runbooks/provisioning.md`, Spec Etappe 3                                                                                 | 5, 10   |

---

### Task 1: Text-Regel und Schlüsselprüfung

**Files:**

- Create: `tools/lint-config/eslint/rules/no-literal-template-text.mjs`, `tools/lint-config/test/no-literal-template-text.spec.mjs`
- Modify: `tools/lint-config/eslint/plugin.mjs`, `tools/lint-config/eslint/index.mjs`
- Create: `tools/lint-config/i18n/check-translation-keys.mjs`, `tools/lint-config/test/check-translation-keys.spec.mjs`
- Modify: `tools/lint-config/package.json`, `package.json` (Wurzel)
- Create: `apps/frontend/transloco.config.cjs`, `apps/frontend/src/i18n/de.json`, `apps/frontend/src/i18n/en.json`
- Create: `apps/frontend/projects/ui/transloco.config.cjs`, `apps/frontend/projects/ui/src/i18n/de.json`, `apps/frontend/projects/ui/src/i18n/en.json`

**Interfaces:**

- Produces: ESLint-Regel `smart/no-literal-template-text` (aktiv für `apps/frontend/**/*.html` einschließlich Inline-Templates, ohne Stories, Specs, `testing/`, `*.story-component.html`).
- Produces: `pnpm i18n:check` – prüft `apps/frontend` und `apps/frontend/projects/ui`, Teil von `pnpm lint`. Exit-Code ≠ 0 bei fehlenden oder ungenutzten Schlüsseln und bei jeder Konfiguration, mit der die Prüfung still nichts prüfen würde.
- Produces: `checkProject(dir: string): { ok: boolean; output: string }` aus `tools/lint-config/i18n/check-translation-keys.mjs`.

Hintergrund für die Schlüsselprüfung (in einem Versuch mit 8.1.1 bestätigt): `transloco-keys-manager find` endet mit 1 bei fehlenden und mit 2 bei ungenutzten Schlüsseln (`emitErrorOnExtraKeys`). Bei falschem Eingabepfad, fehlendem Übersetzungsordner oder ohne Übersetzungsdateien endet es dagegen **still mit 0**. Die Konfiguration sucht es per cosmiconfig nur unter `transloco.config.cjs`/`.js`/`.ts` bzw. `.translocorc*` (nicht `transloco.config.json`), ausgehend vom Arbeitsverzeichnis. Deshalb prüft der Wrapper die Konfiguration selbst und wertet die Ausgabe zusätzlich aus.

- [ ] **Step 1: Failing test – Template-Regel**

Branch anlegen bzw. wechseln: `git switch feat/etappe-3c-sprache-theme-editor` (enthält diesen Plan).

`tools/lint-config/test/no-literal-template-text.spec.mjs`:

```js
import angular from 'angular-eslint';
import { RuleTester } from 'eslint';
import { noLiteralTemplateText } from '../eslint/rules/no-literal-template-text.mjs';

const ruleTester = new RuleTester({ languageOptions: { parser: angular.templateParser } });

ruleTester.run('no-literal-template-text', noLiteralTemplateText, {
  valid: [
    { code: "<p>{{ 'ui.themeEditor.title' | transloco }}</p>" },
    { code: '<p>{{ value() }} · {{ unit() }}</p>' },
    { code: '<span>#</span><span>–</span>' },
    { code: '<ui-icon name="palette" size="sm" />' },
    { code: '<ui-stack gap="md" direction="row" />' },
    { code: '<button type="button" [attr.aria-label]="label()"></button>' },
    { code: '<ui-select [label]="\'ui.themeEditor.variant\' | transloco" />' },
    { code: '<input autocomplete="off" spellcheck="false" />' },
  ],
  invalid: [
    { code: '<p>Hallo</p>', errors: [{ messageId: 'literalText' }] },
    { code: '<p>{{ count() }} Geräte</p>', errors: [{ messageId: 'literalText' }] },
    {
      code: '<ui-icon-button aria-label="Schließen" />',
      errors: [{ messageId: 'literalAttribute', data: { name: 'aria-label' } }],
    },
    {
      code: '<ui-section heading="Farben" />',
      errors: [{ messageId: 'literalAttribute', data: { name: 'heading' } }],
    },
    {
      code: '<ui-switch [label]="\'Farbtreue\'" />',
      errors: [{ messageId: 'literalAttribute', data: { name: 'label' } }],
    },
    {
      code: '<button [attr.title]="\'Mehr\'"></button>',
      errors: [{ messageId: 'literalAttribute', data: { name: 'title' } }],
    },
  ],
});
```

Run: `pnpm --filter @smart/lint-config test -- no-literal-template-text`
Expected: FAIL – Modul `no-literal-template-text.mjs` nicht gefunden.

- [ ] **Step 2: Regel umsetzen**

`tools/lint-config/eslint/rules/no-literal-template-text.mjs`:

```js
const LETTER = /\p{L}/u;

/** Attributes and inputs whose value is shown or read aloud; a literal there is untranslated text. */
export const TEXT_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'description',
  'error',
  'heading',
  'hint',
  'invalidMessage',
  'label',
  'pickerLabel',
  'placeholder',
  'supporting',
  'title',
  'trailingText',
]);

/** A quoted literal in a binding (`[label]="'Text'"`) is a string-valued LiteralPrimitive. */
function literalString(value) {
  const ast = value?.ast ?? value;
  return typeof ast?.value === 'string' ? ast.value : null;
}

/** Spec 7: no visible text without a translation key. Templates only, stories and specs excluded by config. */
export const noLiteralTemplateText = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow visible text in templates that does not come from a translation key.',
    },
    schema: [],
    messages: {
      literalText:
        "Visible text must come from a translation key ({{ 'key' | transloco }}), not a literal.",
      literalAttribute:
        'The attribute "{{name}}" carries visible text; bind a translated value instead of a literal.',
    },
  },
  create(context) {
    const report = (node, messageId, data) =>
      context.report({
        loc: context.sourceCode.parserServices.convertNodeSourceSpanToLoc(node.sourceSpan),
        messageId,
        data,
      });
    return {
      Text(node) {
        if (LETTER.test(node.value)) report(node, 'literalText');
      },
      BoundText(node) {
        const strings = node.value?.ast?.strings ?? [];
        if (LETTER.test(strings.join(''))) report(node, 'literalText');
      },
      TextAttribute(node) {
        if (TEXT_ATTRIBUTES.has(node.name) && LETTER.test(node.value)) {
          report(node, 'literalAttribute', { name: node.name });
        }
      },
      BoundAttribute(node) {
        const value = literalString(node.value);
        if (TEXT_ATTRIBUTES.has(node.name) && value !== null && LETTER.test(value)) {
          report(node, 'literalAttribute', { name: node.name });
        }
      },
    };
  },
};
```

In `tools/lint-config/eslint/plugin.mjs` importieren und unter `rules` als `'no-literal-template-text': noLiteralTemplateText` eintragen.

Run: `pnpm --filter @smart/lint-config test -- no-literal-template-text`
Expected: PASS (14 Fälle).

- [ ] **Step 3: Regel aktivieren und am echten Code beweisen**

In `tools/lint-config/eslint/index.mjs` direkt nach dem Block für `apps/frontend/**/*.html` ergänzen:

```js
    {
      // Spec 7: no visible text without a translation key. Inline templates are linted as
      // virtual files below their .ts file; stories and specs may use German sample texts.
      files: ['apps/frontend/**/*.html'],
      ignores: [
        '**/*.stories.ts/**',
        '**/*.spec.ts/**',
        '**/testing/**',
        '**/*.story-component.html',
      ],
      plugins: { smart: smartPlugin },
      rules: { 'smart/no-literal-template-text': 'error' },
    },
```

Run: `pnpm lint`
Expected: PASS. Stories (z. B. `snackbar.stories.ts` mit „Raum löschen“) und Specs (z. B. `label="Modus"`) enthalten wörtliche Texte; ein grüner Lauf beweist, dass die Ausnahmen greifen.

Gegenprobe (nicht committen): in `apps/frontend/projects/ui/src/lib/empty-state/empty-state.html` vorübergehend `<p>Test</p>` anhängen, `pnpm exec eslint apps/frontend/projects/ui/src/lib/empty-state/empty-state.html` ausführen → genau ein Fehler `smart/no-literal-template-text`; Änderung zurücknehmen. Ebenso in `apps/frontend/src/app/app.ts` das Inline-Template vorübergehend auf `'<router-outlet />Test'` ändern → ein Fehler im virtuellen Inline-Template; zurücknehmen.

- [ ] **Step 4: Failing test – Schlüsselprüfung**

In `tools/lint-config/package.json` unter `dependencies` ergänzen: `"@jsverse/transloco-keys-manager": "8.1.1"`; dann `pnpm install`. Fragt pnpm nach Build-Skripten, nur nach Prüfung freigeben (CLAUDE.md).

`tools/lint-config/test/check-translation-keys.spec.mjs`:

```js
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkProject } from '../i18n/check-translation-keys.mjs';

const config = (input = 'src/app') =>
  `module.exports = { rootTranslationsPath: 'src/i18n', langs: ['de', 'en'], keysManager: { input: ['${input}'], unflat: true, emitErrorOnExtraKeys: true } };\n`;

const COMPONENT = `import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { marker } from '@jsverse/transloco-keys-manager/marker';

export const HINT = marker('app.hint');

@Component({ selector: 'app-x', imports: [TranslocoPipe], template: \`<p>{{ 'app.title' | transloco }}</p>\` })
export class X {}
`;

const COMPLETE = { app: { title: 'Titel', hint: 'Hinweis' } };

let created = [];

/** Writes a throwaway project; `null` leaves a file out. */
function project(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-check-'));
  created.push(dir);
  const files = {
    'transloco.config.cjs': config(),
    'src/app/x.ts': COMPONENT,
    'src/i18n/de.json': COMPLETE,
    'src/i18n/en.json': COMPLETE,
    ...overrides,
  };
  for (const [path, content] of Object.entries(files)) {
    if (content === null) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

afterEach(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
  created = [];
});

describe('checkProject', { timeout: 60_000 }, () => {
  it('passes when every used key exists in every language and nothing else does', () => {
    const result = checkProject(project());
    expect(result.output).toContain('No missing keys');
    expect(result.ok).toBe(true);
  });

  it('fails on a key missing in one language, including keys only marked in code', () => {
    const result = checkProject(project({ 'src/i18n/en.json': { app: { title: 'Title' } } }));
    expect(result.ok).toBe(false);
    expect(result.output).toContain('app.hint');
  });

  it('fails on a key no code uses', () => {
    const result = checkProject(
      project({ 'src/i18n/en.json': { app: { title: 'Title', hint: 'Hint', old: 'Old' } } }),
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain('app.old');
  });

  it('fails instead of passing silently when a language file is missing', () => {
    const result = checkProject(project({ 'src/i18n/en.json': null }));
    expect(result.ok).toBe(false);
    expect(result.output).toContain('en.json');
  });

  it('fails instead of passing silently when the input folder does not exist', () => {
    const result = checkProject(project({ 'transloco.config.cjs': config('src/missing') }));
    expect(result.ok).toBe(false);
    expect(result.output).toContain('src/missing');
  });

  it('fails without a config file', () => {
    const result = checkProject(project({ 'transloco.config.cjs': null }));
    expect(result.ok).toBe(false);
    expect(result.output).toContain('transloco.config.cjs');
  });
});
```

Run: `pnpm --filter @smart/lint-config test -- check-translation-keys`
Expected: FAIL – Modul `check-translation-keys.mjs` nicht gefunden.

- [ ] **Step 5: Schlüsselprüfung umsetzen**

`tools/lint-config/i18n/check-translation-keys.mjs`:

```js
#!/usr/bin/env node
// Fails when a translation key is used but missing in a language file, or present but unused.
// Wraps transloco-keys-manager, which exits 0 without checking anything when its paths are wrong.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const LANGS = ['de', 'en'];
const CLI = join(import.meta.dirname, '../node_modules/.bin/transloco-keys-manager');
/** Messages after which the tool exits 0 although it checked nothing. */
const SILENT_FAILURES = ["Translations path provided doesn't exist", 'No translation files found'];

/** Problems that would make the check pass without checking anything. */
export function validateProject(dir) {
  const configPath = resolve(dir, 'transloco.config.cjs');
  if (!existsSync(configPath)) return [`${configPath} is missing`];
  const config = require(configPath);
  const problems = [];
  if (JSON.stringify(config.langs) !== JSON.stringify(LANGS)) {
    problems.push(`langs must be ${JSON.stringify(LANGS)}`);
  }
  if (config.keysManager?.emitErrorOnExtraKeys !== true) {
    problems.push('keysManager.emitErrorOnExtraKeys must be true');
  }
  const inputs = config.keysManager?.input ?? [];
  if (inputs.length === 0) problems.push('keysManager.input is empty');
  for (const input of inputs) {
    if (!existsSync(join(dir, input))) problems.push(`input ${join(dir, input)} does not exist`);
  }
  for (const lang of LANGS) {
    const file = join(dir, config.rootTranslationsPath ?? '', `${lang}.json`);
    if (!existsSync(file)) problems.push(`${file} is missing`);
  }
  return problems;
}

/** @returns {{ ok: boolean, output: string }} */
export function checkProject(dir) {
  const problems = validateProject(dir);
  if (problems.length > 0) return { ok: false, output: problems.join('\n') };
  const result = spawnSync(CLI, ['find'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const silent = SILENT_FAILURES.some((message) => output.includes(message));
  return { ok: result.status === 0 && !silent, output };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error('Usage: check-translation-keys.mjs <project dir>...');
    process.exit(2);
  }
  let failed = false;
  for (const dir of dirs) {
    const { ok, output } = checkProject(dir);
    console.log(`\n== ${dir}: ${ok ? 'ok' : 'FAILED'}\n${output}`);
    failed ||= !ok;
  }
  process.exit(failed ? 1 : 0);
}
```

Run: `pnpm --filter @smart/lint-config test -- check-translation-keys`
Expected: PASS (6 Tests).

- [ ] **Step 6: Projekte anbinden**

`apps/frontend/transloco.config.cjs`:

```js
// Translation key check of the app (pnpm i18n:check). The UI library has its own config in
// projects/ui; its keys (ui.*) are merged into the app's root translation at runtime.
module.exports = {
  rootTranslationsPath: 'src/i18n',
  langs: ['de', 'en'],
  keysManager: { input: ['src/app'], unflat: true, emitErrorOnExtraKeys: true },
};
```

`apps/frontend/projects/ui/transloco.config.cjs`:

```js
// Translation key check of @smart/ui (pnpm i18n:check). All keys live under "ui." so they cannot
// clash with app keys when both files are merged into one root translation.
module.exports = {
  rootTranslationsPath: 'src/i18n',
  langs: ['de', 'en'],
  keysManager: { input: ['src/lib'], unflat: true, emitErrorOnExtraKeys: true },
};
```

`apps/frontend/src/i18n/de.json`, `apps/frontend/src/i18n/en.json`, `apps/frontend/projects/ui/src/i18n/de.json`, `apps/frontend/projects/ui/src/i18n/en.json`: jeweils `{}` (die ersten Schlüssel kommen mit Task 8).

Wurzel-`package.json`, `scripts`:

```json
"i18n:check": "node tools/lint-config/i18n/check-translation-keys.mjs apps/frontend apps/frontend/projects/ui",
```

und `lint` am Ende um ` && pnpm i18n:check` ergänzen.

Run: `pnpm i18n:check`
Expected: zweimal `ok`, Exit 0. (Die rote Meldung „Unable to load workspace config … Defaulting source root to 'src'“ im UI-Projekt ist erwartet: dort liegt kein `angular.json`.)

Gegenprobe (nicht committen): in `apps/frontend/projects/ui/src/i18n/en.json` `{"ui":{"x":"y"}}` eintragen → `pnpm i18n:check` endet mit 1 und nennt `ui.x`; zurücknehmen.

- [ ] **Step 7: Prüfen und committen**

Run: `pnpm format:check && pnpm lint && pnpm --filter @smart/lint-config test && pnpm licenses:check`
Expected: PASS. Meldet `licenses:check` eine neue Lizenz aus dem Keys Manager, nicht pauschal freigeben: Lizenz prüfen, nur permissive Lizenzen mit Test in die Allowlist (wie Zlib in 3b), sonst melden.

```bash
git add tools/lint-config package.json pnpm-lock.yaml apps/frontend/transloco.config.cjs apps/frontend/src/i18n apps/frontend/projects/ui/transloco.config.cjs apps/frontend/projects/ui/src/i18n
git commit -m "feat(lint): forbid untranslated template text and check translation keys"
```

---

### Task 2: Sprache zur Laufzeit

**Files:**

- Create: `packages/contracts/src/language.ts`, `packages/contracts/src/language.spec.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/frontend/package.json`, `apps/frontend/tsconfig.json`
- Create: `apps/frontend/projects/ui/src/lib/i18n/ui-translations.ts`, `apps/frontend/projects/ui/src/lib/i18n/ui-translations.spec.ts`
- Create: `apps/frontend/projects/ui/src/lib/testing/i18n-testing.ts`
- Modify: `apps/frontend/projects/ui/src/public-api.ts`
- Create: `apps/frontend/src/app/core/i18n/index.ts`, `language-store.ts`, `language-store.spec.ts`, `language.service.ts`, `language.service.spec.ts`, `app-translation-loader.ts`, `app-translation-loader.spec.ts`, `provide-i18n.ts`
- Modify: `apps/frontend/src/app/app.config.ts`, `apps/frontend/src/index.html`
- Modify: `tests/e2e/specs/stack-smoke.spec.ts`

**Interfaces:**

- Produces (`@smart/contracts`): `LANGUAGES = ['de', 'en'] as const`, `type Language`, `DEFAULT_LANGUAGE: Language = 'de'`, `languageSchema`, `matchLanguage(preferred: readonly string[]): Language`.
- Produces (`@smart/ui`): `loadUiTranslation(language: Language): Promise<Translation>`.
- Produces (UI-intern, nur Tests/Stories): `provideUiTranslocoTesting(language?: Language): EnvironmentProviders` aus `lib/testing/i18n-testing.ts`.
- Produces (App, `core/i18n/index.ts`): `provideI18n(): EnvironmentProviders`, `LanguageService` (`language: Signal<Language>`, `setLanguage(language: Language): void`), `LANGUAGE_STORE`, `BROWSER_LANGUAGES`, `LocalStorageLanguageStore`, `type LanguageStore`.

- [ ] **Step 1: Failing test – Sprachliste und Zuordnung**

`packages/contracts/src/language.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_LANGUAGE, LANGUAGES, languageSchema, matchLanguage } from './language.js';

describe('languages', () => {
  it('supports German and English with German as default', () => {
    expect(LANGUAGES).toEqual(['de', 'en']);
    expect(DEFAULT_LANGUAGE).toBe('de');
    expect(languageSchema.safeParse('en').success).toBe(true);
    expect(languageSchema.safeParse('fr').success).toBe(false);
  });

  it.each([
    [['en-US', 'de'], 'en'],
    [['de-AT'], 'de'],
    [['EN-gb'], 'en'],
    [['fr-FR', 'en-GB'], 'en'],
    [['fr'], 'de'],
    [[], 'de'],
    [[''], 'de'],
  ])('matches the browser languages %j to %s', (preferred, expected) => {
    expect(matchLanguage(preferred)).toBe(expected);
  });
});
```

Run: `pnpm --filter @smart/contracts test`
Expected: FAIL – `./language.js` nicht gefunden.

- [ ] **Step 2: Sprachliste umsetzen**

`packages/contracts/src/language.ts`:

```ts
import * as z from 'zod/mini';

export const LANGUAGES = ['de', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'de';
export const languageSchema = z.enum(LANGUAGES);

/** First supported language among the browser's preferences (by primary subtag), else German. */
export function matchLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split('-')[0];
    const match = LANGUAGES.find((language) => language === primary);
    if (match) return match;
  }
  return DEFAULT_LANGUAGE;
}
```

In `packages/contracts/src/index.ts` ergänzen: `export * from './language.js';`

Run: `pnpm --filter @smart/contracts test && pnpm packages:build`
Expected: PASS.

- [ ] **Step 3: Transloco und UI-Übersetzungen – failing test**

`apps/frontend/package.json`: unter `dependencies` `"@jsverse/transloco": "8.4.0"` ergänzen; `pnpm install`.
`apps/frontend/tsconfig.json`: in `compilerOptions` `"resolveJsonModule": true` ergänzen (Übersetzungen werden als JSON-Module lazy importiert).

`apps/frontend/projects/ui/src/lib/i18n/ui-translations.spec.ts`:

```ts
import de from '../../i18n/de.json';
import en from '../../i18n/en.json';
import { loadUiTranslation } from './ui-translations';

describe('loadUiTranslation', () => {
  it('loads the library texts of each language', async () => {
    await expect(loadUiTranslation('de')).resolves.toEqual(de);
    await expect(loadUiTranslation('en')).resolves.toEqual(en);
  });

  it('keeps every library key below "ui" so it cannot clash with app keys', () => {
    for (const translation of [de, en]) {
      expect(Object.keys(translation).filter((key) => key !== 'ui')).toEqual([]);
    }
  });
});
```

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: FAIL – `./ui-translations` nicht gefunden.

- [ ] **Step 4: UI-Übersetzungen umsetzen**

`apps/frontend/projects/ui/src/lib/i18n/ui-translations.ts`:

```ts
import type { Translation } from '@jsverse/transloco';
import type { Language } from '@smart/contracts';

const LOADERS: Record<Language, () => Promise<Translation>> = {
  de: () => import('../../i18n/de.json').then((module) => module.default),
  en: () => import('../../i18n/en.json').then((module) => module.default),
};

/** The library's own texts (keys `ui.*`); the app and Storybook merge them into their root translation. */
export function loadUiTranslation(language: Language): Promise<Translation> {
  return LOADERS[language]();
}
```

`apps/frontend/projects/ui/src/lib/testing/i18n-testing.ts`:

```ts
import { importProvidersFrom, type EnvironmentProviders } from '@angular/core';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { LANGUAGES, type Language } from '@smart/contracts';
import de from '../../i18n/de.json';
import en from '../../i18n/en.json';

/** Transloco with the library's real texts, preloaded so templates render translated at once. */
export function provideUiTranslocoTesting(language: Language = 'de'): EnvironmentProviders {
  return importProvidersFrom(
    TranslocoTestingModule.forRoot({
      langs: { de, en },
      translocoConfig: { availableLangs: [...LANGUAGES], defaultLang: language },
      preloadLangs: true,
    }),
  );
}
```

In `public-api.ts` ergänzen: `export { loadUiTranslation } from './lib/i18n/ui-translations';`

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: PASS.

- [ ] **Step 5: Failing tests – Sprachspeicher, Loader, LanguageService**

`apps/frontend/src/app/core/i18n/language-store.spec.ts`:

```ts
import { LocalStorageLanguageStore } from './language-store';

const storage = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
};

describe('LocalStorageLanguageStore', () => {
  it('reads and writes the chosen language', () => {
    const backing = storage();
    const store = new LocalStorageLanguageStore(backing);
    store.save('en');
    expect(backing.data['smart.language']).toBe('en');
    expect(store.load()).toBe('en');
  });

  it.each(['fr', '', 'null'])('ignores the unsupported stored value %j', (value) => {
    expect(new LocalStorageLanguageStore(storage({ 'smart.language': value })).load()).toBeNull();
  });

  it('never throws when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    const store = new LocalStorageLanguageStore(blocked);
    expect(store.load()).toBeNull();
    expect(() => store.save('en')).not.toThrow();
  });
});
```

`apps/frontend/src/app/core/i18n/app-translation-loader.spec.ts`:

```ts
import { loadUiTranslation } from '@smart/ui';
import appDe from '../../../i18n/de.json';
import appEn from '../../../i18n/en.json';
import { AppTranslationLoader } from './app-translation-loader';

describe('AppTranslationLoader', () => {
  it('merges the app and library texts of a language', async () => {
    const loader = new AppTranslationLoader();
    await expect(loader.getTranslation('de')).resolves.toEqual({
      ...appDe,
      ...(await loadUiTranslation('de')),
    });
    await expect(loader.getTranslation('en')).resolves.toEqual({
      ...appEn,
      ...(await loadUiTranslation('en')),
    });
  });

  it('falls back to German for a language it does not know', async () => {
    const loader = new AppTranslationLoader();
    await expect(loader.getTranslation('fr')).resolves.toEqual(await loader.getTranslation('de'));
  });
});
```

`apps/frontend/src/app/core/i18n/language.service.spec.ts`:

```ts
import { DOCUMENT, importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { Language } from '@smart/contracts';
import { BROWSER_LANGUAGES, LANGUAGE_STORE, type LanguageStore } from './language-store';
import { LanguageService } from './language.service';

class MemoryLanguageStore implements LanguageStore {
  value: Language | null = null;
  load = () => this.value;
  save = (language: Language) => {
    this.value = language;
  };
}

function setup({ stored = null as Language | null, browser = [] as string[] } = {}) {
  const store = new MemoryLanguageStore();
  store.value = stored;
  TestBed.configureTestingModule({
    providers: [
      importProvidersFrom(
        TranslocoTestingModule.forRoot({
          langs: { de: {}, en: {} },
          translocoConfig: { availableLangs: ['de', 'en'], defaultLang: 'de' },
        }),
      ),
      { provide: LANGUAGE_STORE, useValue: store },
      { provide: BROWSER_LANGUAGES, useValue: browser },
    ],
  });
  return {
    service: TestBed.inject(LanguageService),
    store,
    transloco: TestBed.inject(TranslocoService),
    html: TestBed.inject(DOCUMENT).documentElement,
  };
}

describe('LanguageService', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it('starts with the stored language over the browser preference', () => {
    const { service } = setup({ stored: 'en', browser: ['de-DE'] });
    expect(service.language()).toBe('en');
  });

  it('starts with the first supported browser language without a stored choice', () => {
    const { service, transloco, html } = setup({ browser: ['fr-FR', 'en-GB'] });
    expect(service.language()).toBe('en');
    expect(transloco.getActiveLang()).toBe('en');
    expect(html.lang).toBe('en');
  });

  it('falls back to German', () => {
    expect(setup({ browser: ['fr'] }).service.language()).toBe('de');
  });

  it('switches, stores and announces a new language', () => {
    const { service, store, transloco, html } = setup();
    service.setLanguage('en');
    expect(service.language()).toBe('en');
    expect(store.value).toBe('en');
    expect(transloco.getActiveLang()).toBe('en');
    expect(html.lang).toBe('en');
  });

  it('rejects languages the app does not support', () => {
    const { service } = setup();
    expect(() => service.setLanguage('fr' as Language)).toThrow();
    expect(service.language()).toBe('de');
  });
});
```

Run: `pnpm --filter @smart/frontend exec ng test frontend --watch=false`
Expected: FAIL – Module unter `core/i18n` fehlen.

- [ ] **Step 6: Sprachspeicher, Loader, LanguageService, Provider umsetzen**

`apps/frontend/src/app/core/i18n/language-store.ts`:

```ts
import { InjectionToken } from '@angular/core';
import { languageSchema, type Language } from '@smart/contracts';

export interface LanguageStore {
  load(): Language | null;
  save(language: Language): void;
}

const KEY = 'smart.language';
type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Stage 3 persistence in the browser; stage 4 moves the choice to the user. Never throws. */
export class LocalStorageLanguageStore implements LanguageStore {
  /** `storage` is for tests; `localStorage` is resolved lazily because merely reading it can throw. */
  constructor(private readonly storage?: KeyValueStorage) {}

  load(): Language | null {
    try {
      const parsed = languageSchema.safeParse(
        (this.storage ?? globalThis.localStorage)?.getItem(KEY),
      );
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  save(language: Language): void {
    try {
      (this.storage ?? globalThis.localStorage)?.setItem(KEY, language);
    } catch {
      // Storage blocked or full: the language still applies for this session.
    }
  }
}

export const LANGUAGE_STORE = new InjectionToken<LanguageStore>('LANGUAGE_STORE', {
  providedIn: 'root',
  factory: () => new LocalStorageLanguageStore(),
});

/** The browser's preferred languages, most preferred first. */
export const BROWSER_LANGUAGES = new InjectionToken<readonly string[]>('BROWSER_LANGUAGES', {
  providedIn: 'root',
  factory: () => globalThis.navigator?.languages ?? [],
});
```

`apps/frontend/src/app/core/i18n/app-translation-loader.ts`:

```ts
import { Injectable } from '@angular/core';
import type { Translation, TranslocoLoader } from '@jsverse/transloco';
import { DEFAULT_LANGUAGE, languageSchema, type Language } from '@smart/contracts';
import { loadUiTranslation } from '@smart/ui';

const APP: Record<Language, () => Promise<Translation>> = {
  de: () => import('../../../i18n/de.json').then((module) => module.default),
  en: () => import('../../../i18n/en.json').then((module) => module.default),
};

/** Root translation = app texts + library texts (`ui.*`), each lazily loaded per language. */
@Injectable({ providedIn: 'root' })
export class AppTranslationLoader implements TranslocoLoader {
  async getTranslation(lang: string): Promise<Translation> {
    const parsed = languageSchema.safeParse(lang);
    const language = parsed.success ? parsed.data : DEFAULT_LANGUAGE;
    const [app, ui] = await Promise.all([APP[language](), loadUiTranslation(language)]);
    return { ...app, ...ui };
  }
}
```

`apps/frontend/src/app/core/i18n/language.service.ts`:

```ts
import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { languageSchema, matchLanguage, type Language } from '@smart/contracts';
import { BROWSER_LANGUAGES, LANGUAGE_STORE } from './language-store';

/** Active UI language: stored choice, else the browser's preference, else German (spec 7). */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly transloco = inject(TranslocoService);
  private readonly store = inject(LANGUAGE_STORE);
  private readonly document = inject(DOCUMENT);
  private readonly state = signal<Language>(
    this.store.load() ?? matchLanguage(inject(BROWSER_LANGUAGES)),
  );
  readonly language = this.state.asReadonly();

  constructor() {
    this.apply(this.state());
  }

  setLanguage(language: Language): void {
    const parsed = languageSchema.parse(language);
    this.state.set(parsed);
    this.store.save(parsed);
    this.apply(parsed);
  }

  /** `<html lang>` drives screen reader pronunciation and `hyphens: auto`. */
  private apply(language: Language): void {
    this.transloco.setActiveLang(language);
    this.document.documentElement.lang = language;
  }
}
```

`apps/frontend/src/app/core/i18n/provide-i18n.ts`:

```ts
import {
  inject,
  isDevMode,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { provideTransloco } from '@jsverse/transloco';
import { DEFAULT_LANGUAGE, LANGUAGES } from '@smart/contracts';
import { AppTranslationLoader } from './app-translation-loader';
import { LanguageService } from './language.service';

/** Transloco for the app; the LanguageService starts with the app and picks the language. */
export function provideI18n(): EnvironmentProviders {
  return makeEnvironmentProviders([
    ...provideTransloco({
      config: {
        availableLangs: [...LANGUAGES],
        defaultLang: DEFAULT_LANGUAGE,
        fallbackLang: DEFAULT_LANGUAGE,
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
        missingHandler: { useFallbackTranslation: true, logMissingKey: isDevMode() },
      },
      loader: AppTranslationLoader,
    }),
    provideEnvironmentInitializer(() => {
      inject(LanguageService);
    }),
  ]);
}
```

`apps/frontend/src/app/core/i18n/index.ts`:

```ts
export { AppTranslationLoader } from './app-translation-loader';
export {
  BROWSER_LANGUAGES,
  LANGUAGE_STORE,
  LocalStorageLanguageStore,
  type LanguageStore,
} from './language-store';
export { LanguageService } from './language.service';
export { provideI18n } from './provide-i18n';
```

`apps/frontend/src/app/app.config.ts`: `provideI18n()` aus `./core/i18n` in `providers` ergänzen (vor `provideTheme()`).
`apps/frontend/src/index.html`: `<html lang="en">` → `<html lang="de">` (gilt bis der LanguageService läuft und für Browser ohne JavaScript).

Run: `pnpm --filter @smart/frontend test`
Expected: PASS (App und UI).

- [ ] **Step 7: E2E – Seitensprache folgt dem Browser**

In `tests/e2e/specs/stack-smoke.spec.ts` ergänzen:

```ts
for (const [locale, lang] of [
  ['en-US', 'en'],
  ['de-DE', 'de'],
  ['fr-FR', 'de'],
] as const) {
  test(`a browser preferring ${locale} gets the page language ${lang}`, async ({ browser }) => {
    const context = await browser.newContext({ locale });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await context.close();
  });
}
```

Run: `sh infra/compose/test/stack-test.sh`
Expected: PASS einschließlich der drei neuen Tests (der Test „no console errors“ bleibt grün: leere Übersetzungen erzeugen keine Fehler).

- [ ] **Step 8: Prüfen und committen**

Run: Prüfung am Ende der Task (Global Constraints) und `pnpm i18n:check`. Der Build-Bericht nennt die initiale Größe; sie bleibt unter 500 kB.

```bash
git add packages/contracts apps/frontend tests/e2e pnpm-lock.yaml
git commit -m "feat(frontend): add German and English with Transloco and the browser language"
```

---

### Task 3: Theme – Vorrang, Tabs, Kontrast im Boot-Cache, graue Overrides

**Files:**

- Modify: `packages/theme/src/scheme.ts`, `packages/theme/src/theme.spec.ts`
- Modify: `apps/frontend/projects/ui/src/lib/theme/appearance-store.ts`, `appearance-store.spec.ts`
- Create: `apps/frontend/projects/ui/src/lib/theme/memory-appearance-store.ts`
- Modify: `apps/frontend/projects/ui/src/lib/theme/instance-appearance.token.ts`, `provide-theme.ts`, `theme.service.ts`, `theme.service.spec.ts`
- Modify: `apps/frontend/projects/ui/src/public-api.ts`
- Modify: `apps/frontend/public/theme-boot.js`, `apps/frontend/src/app/theme-boot.spec.ts`
- Modify: `tests/e2e/specs/stack-smoke.spec.ts`

**Interfaces:**

- Consumes: `computeThemeVars`, `resolveAppearance` aus `@smart/theme`.
- Produces (`@smart/ui`):
  - `BOOT_CACHE_VERSION = 2`; `BootCache { v: 2; mode: ThemeMode; followsSystemContrast: boolean; light; dark; lightHigh?; darkHigh? }` (alle Variablen `Record<string, string>`).
  - `type AppearanceKey = 'instance' | 'personal'`; `AppearanceStore` zusätzlich mit `clearInstance(): void`, `clearPersonal(): void`, `watch(callback: (key: AppearanceKey) => void): () => void`.
  - `MemoryAppearanceStore` (für Tests und Storybook; Felder `instance`, `personal`, `boot`, Methode `emit(key)` simuliert einen anderen Tab).
  - `STORED_INSTANCE_ALLOWED: InjectionToken<boolean>` (Standard `false`); `provideTheme(options?: { instance?: InstanceAppearance; allowStoredInstance?: boolean })`.
  - `ThemeService.instance` und `.personal` sind `Signal` (nur lesend); neu `resetPersonal(): void`, `resetInstance(): void`; `setInstance` speichert nur bei `allowStoredInstance`.
- Produces (`theme-boot.js`): wendet nur Caches mit `v === 2` an; wählt bei `followsSystemContrast` und `prefers-contrast: more` die Variablen `lightHigh`/`darkHigh`.

- [ ] **Step 1: Failing test – graue Overrides bleiben grau**

In `packages/theme/src/theme.spec.ts` ergänzen (Importe `Hct`, `argbFromHex` aus `@material/material-color-utilities` oben aufnehmen, falls noch nicht vorhanden):

```ts
describe('core color overrides without colorMatch', () => {
  const chromaOf = (hex: string) => Hct.fromInt(argbFromHex(hex)).chroma;
  const secondaryWith = (override: string) =>
    computeThemeVars({
      colors: {
        seed: '#00687a',
        variant: 'vibrant',
        colorMatch: false,
        coreOverrides: { secondary: override },
      },
      shape: 'standard',
      font: 'roboto-flex',
      mode: 'light',
      contrast: 'standard',
    })['--mat-sys-secondary']!;

  it('keeps a gray override gray instead of giving it the variant chroma', () => {
    expect(chromaOf(secondaryWith('#808080'))).toBeLessThan(6);
    expect(chromaOf(secondaryWith('#7a7f85'))).toBeLessThan(6);
  });

  it('still takes only the hue of a colorful override', () => {
    expect(chromaOf(secondaryWith('#3e5f90'))).toBeGreaterThan(12);
  });
});
```

Run: `pnpm --filter @smart/theme test`
Expected: FAIL – das graue Override bekommt die Buntheit der Variante (Chroma deutlich über 6).

- [ ] **Step 2: Engine anpassen**

In `packages/theme/src/scheme.ts` oberhalb von `buildScheme` ergänzen:

```ts
/** Below this chroma an override reads as gray; it then keeps its own chroma (spec 4.4, carry-over 3a). */
const ACHROMATIC_CHROMA = 6;
```

und die innere Funktion `palette` ersetzen durch:

```ts
// With colorMatch an override keeps its own chroma; otherwise only its hue is used –
// except for grays, which would otherwise turn into a random hue at the variant's chroma.
const palette = (id: CoreColorId, fallback: TonalPalette): TonalPalette => {
  const hex = overrides[id];
  if (!hex) return fallback;
  const argb = argbFromHex(hex);
  if (colors.colorMatch) return TonalPalette.fromInt(argb);
  const hct = Hct.fromInt(argb);
  return TonalPalette.fromHueAndChroma(
    hct.hue,
    hct.chroma < ACHROMATIC_CHROMA ? hct.chroma : fallback.chroma,
  );
};
```

Run: `pnpm --filter @smart/theme test && pnpm --filter @smart/theme generate:default-css && pnpm packages:build`
Expected: PASS; die Standard-CSS ändert sich nicht (Standard hat keine Overrides – `git status` zeigt `default-theme.css` unverändert).

- [ ] **Step 3: Failing tests – Speicher**

In `apps/frontend/projects/ui/src/lib/theme/appearance-store.spec.ts`:

- In den bestehenden Tests erhalten alle Fake-Speicher zusätzlich `removeItem` (gleiches Verhalten wie ihr `setItem`), und der Boot-Cache im Test „blocks access to localStorage itself“ lautet `{ v: 2, mode: 'light', followsSystemContrast: false, light: {}, dark: {} }`.
- Neue Tests ergänzen:

```ts
it('keeps mode and contrast when only the stored colors are invalid', () => {
  localStorage.setItem(
    'smart.appearance.personal',
    JSON.stringify({ mode: 'dark', contrast: 'high', colors: { seed: 'blue' } }),
  );
  expect(new LocalStorageAppearanceStore().loadPersonal()).toEqual({
    mode: 'dark',
    contrast: 'high',
  });
});

it('forgets stored appearance on clear', () => {
  const store = new LocalStorageAppearanceStore();
  store.savePersonal({ mode: 'dark', contrast: 'high' });
  store.saveInstance(DEFAULT_INSTANCE_APPEARANCE);
  store.clearPersonal();
  store.clearInstance();
  expect(store.loadPersonal()).toBeNull();
  expect(store.loadInstance()).toBeNull();
});

it('reports changes another tab makes to its keys only', () => {
  const store = new LocalStorageAppearanceStore();
  const seen: string[] = [];
  const stop = store.watch((key) => seen.push(key));
  window.dispatchEvent(new StorageEvent('storage', { key: 'smart.appearance.personal' }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'smart.appearance.instance' }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'smart.theme.boot' }));
  window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
  // key null: the other tab cleared the whole storage.
  window.dispatchEvent(new StorageEvent('storage', { key: null }));
  stop();
  window.dispatchEvent(new StorageEvent('storage', { key: 'smart.appearance.personal' }));
  expect(seen).toEqual(['personal', 'instance', 'instance', 'personal']);
});
```

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: FAIL – `clearPersonal`, `watch` fehlen; ungültige Farben verwerfen alles.

- [ ] **Step 4: Speicher umsetzen**

`apps/frontend/projects/ui/src/lib/theme/appearance-store.ts` vollständig:

```ts
import { InjectionToken } from '@angular/core';
import {
  instanceAppearanceSchema,
  personalAppearanceSchema,
  type InstanceAppearance,
  type PersonalAppearance,
  type ThemeMode,
} from '@smart/contracts';

/** Bump when the cache format changes; theme-boot.js ignores other versions. */
export const BOOT_CACHE_VERSION = 2;

/**
 * What theme-boot.js applies before Angular starts. Both modes are cached so "system" follows the
 * OS without a flash; while the contrast follows the system, both contrast levels are cached too.
 */
export interface BootCache {
  readonly v: typeof BOOT_CACHE_VERSION;
  readonly mode: ThemeMode;
  readonly followsSystemContrast: boolean;
  readonly light: Record<string, string>;
  readonly dark: Record<string, string>;
  readonly lightHigh?: Record<string, string>;
  readonly darkHigh?: Record<string, string>;
}

export type AppearanceKey = 'instance' | 'personal';

export interface AppearanceStore {
  loadInstance(): InstanceAppearance | null;
  loadPersonal(): PersonalAppearance | null;
  saveInstance(value: InstanceAppearance): void;
  savePersonal(value: PersonalAppearance): void;
  clearInstance(): void;
  clearPersonal(): void;
  saveBootCache(value: BootCache): void;
  /** Calls back when another tab changed a stored appearance; returns the unsubscribe function. */
  watch(callback: (key: AppearanceKey) => void): () => void;
}

const KEYS = {
  instance: 'smart.appearance.instance',
  personal: 'smart.appearance.personal',
  boot: 'smart.theme.boot',
} as const;
type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Stage 3 persistence in the browser; replaced by the API in stage 4. Never throws. */
export class LocalStorageAppearanceStore implements AppearanceStore {
  /** `storage` is for tests; by default `localStorage` is resolved lazily because merely reading it can throw. */
  constructor(private readonly storage?: KeyValueStorage) {}

  loadInstance(): InstanceAppearance | null {
    return this.read(KEYS.instance, (raw) => instanceAppearanceSchema.parse(raw));
  }
  loadPersonal(): PersonalAppearance | null {
    return this.read(KEYS.personal, (raw) => {
      const full = personalAppearanceSchema.safeParse(raw);
      if (full.success) return full.data;
      // Keep mode and contrast when only the stored colors are unusable (e.g. an older format).
      const rest = typeof raw === 'object' && raw !== null ? raw : {};
      return personalAppearanceSchema.parse({ ...rest, colors: undefined });
    });
  }
  saveInstance(value: InstanceAppearance): void {
    this.write(KEYS.instance, value);
  }
  savePersonal(value: PersonalAppearance): void {
    this.write(KEYS.personal, value);
  }
  clearInstance(): void {
    this.remove(KEYS.instance);
  }
  clearPersonal(): void {
    this.remove(KEYS.personal);
  }
  saveBootCache(value: BootCache): void {
    this.write(KEYS.boot, value);
  }

  watch(callback: (key: AppearanceKey) => void): () => void {
    const target = globalThis.window;
    if (!target?.addEventListener) return () => undefined;
    const listener = (event: StorageEvent) => {
      if (event.key === KEYS.instance || event.key === null) callback('instance');
      if (event.key === KEYS.personal || event.key === null) callback('personal');
    };
    target.addEventListener('storage', listener);
    return () => target.removeEventListener('storage', listener);
  }

  /** Only call inside try/catch: accessing localStorage throws a SecurityError when site data is blocked. */
  private resolveStorage(): KeyValueStorage | undefined {
    return this.storage ?? globalThis.localStorage;
  }
  private read<T>(key: string, parse: (raw: unknown) => T): T | null {
    try {
      const raw = this.resolveStorage()?.getItem(key);
      return raw ? parse(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }
  private write(key: string, value: unknown): void {
    try {
      this.resolveStorage()?.setItem(key, JSON.stringify(value));
    } catch {
      // Storage blocked or full: the theme still works for this session.
    }
  }
  private remove(key: string): void {
    try {
      this.resolveStorage()?.removeItem(key);
    } catch {
      // Storage blocked: nothing stored that could be removed.
    }
  }
}

export const APPEARANCE_STORE = new InjectionToken<AppearanceStore>('APPEARANCE_STORE', {
  providedIn: 'root',
  factory: () => new LocalStorageAppearanceStore(),
});
```

Hinweis: Die Reihenfolge der Rückrufe bei `key === null` (erst `instance`, dann `personal`) ist im Test festgelegt.

`apps/frontend/projects/ui/src/lib/theme/memory-appearance-store.ts`:

```ts
import type { InstanceAppearance, PersonalAppearance } from '@smart/contracts';
import type { AppearanceKey, AppearanceStore, BootCache } from './appearance-store';

/** In-memory store for tests and Storybook; `emit` simulates a change made in another tab. */
export class MemoryAppearanceStore implements AppearanceStore {
  instance: InstanceAppearance | null = null;
  personal: PersonalAppearance | null = null;
  boot: BootCache | null = null;
  private readonly listeners = new Set<(key: AppearanceKey) => void>();

  loadInstance(): InstanceAppearance | null {
    return this.instance;
  }
  loadPersonal(): PersonalAppearance | null {
    return this.personal;
  }
  saveInstance(value: InstanceAppearance): void {
    this.instance = value;
  }
  savePersonal(value: PersonalAppearance): void {
    this.personal = value;
  }
  clearInstance(): void {
    this.instance = null;
  }
  clearPersonal(): void {
    this.personal = null;
  }
  saveBootCache(value: BootCache): void {
    this.boot = value;
  }
  watch(callback: (key: AppearanceKey) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }
  emit(key: AppearanceKey): void {
    for (const listener of this.listeners) listener(key);
  }
}
```

Run: `pnpm --filter @smart/frontend exec tsc -p projects/ui/tsconfig.lib.json --noEmit`
Expected: PASS (die Bibliothek kompiliert). Die UI-Tests laufen erst nach Step 6 wieder: Bis dahin kompiliert `theme.service.spec.ts` mit dem neuen Speicher-Interface nicht, und ein Kompilierfehler stoppt den ganzen Testlauf.

- [ ] **Step 5: Failing tests – ThemeService**

In `apps/frontend/projects/ui/src/lib/theme/theme.service.spec.ts`:

- Die lokale Klasse `MemoryStore` löschen und durch `MemoryAppearanceStore` aus `./memory-appearance-store` ersetzen; `setup` erhält Optionen:

```ts
function setup(
  store = new MemoryAppearanceStore(),
  media = new FakeMedia(),
  options: { instance?: InstanceAppearance; allowStoredInstance?: boolean } = {},
) {
  TestBed.configureTestingModule({
    providers: [
      provideTheme(options),
      { provide: APPEARANCE_STORE, useValue: store },
      { provide: MEDIA_QUERIES, useValue: media },
    ],
  });
  const service = TestBed.inject(ThemeService);
  TestBed.tick();
  return { service, store, media };
}
```

- Neue Tests im `describe('ThemeService')`:

```ts
const plumInstance: InstanceAppearance = { ...DEFAULT_INSTANCE_APPEARANCE, colors: plum };
const sharpInstance: InstanceAppearance = { ...DEFAULT_INSTANCE_APPEARANCE, shape: 'kantig' };

it('ignores a browser-stored instance theme while the instance editor is off', () => {
  const store = new MemoryAppearanceStore();
  store.instance = sharpInstance;
  const { service } = setup(store, new FakeMedia(), { instance: plumInstance });
  expect(service.instance()).toEqual(plumInstance);
});

it('prefers a browser-stored instance theme while the instance editor is on', () => {
  const store = new MemoryAppearanceStore();
  store.instance = sharpInstance;
  const { service } = setup(store, new FakeMedia(), {
    instance: plumInstance,
    allowStoredInstance: true,
  });
  expect(service.instance()).toEqual(sharpInstance);
});

it('stores instance changes only while the instance editor is on', () => {
  const off = setup(new MemoryAppearanceStore(), new FakeMedia());
  off.service.setInstance(sharpInstance);
  expect(off.service.instance()).toEqual(sharpInstance);
  expect(off.store.instance).toBeNull();
  TestBed.resetTestingModule();
  const on = setup(new MemoryAppearanceStore(), new FakeMedia(), { allowStoredInstance: true });
  on.service.setInstance(sharpInstance);
  expect(on.store.instance).toEqual(sharpInstance);
});

it('resets the instance to the installation default and forgets the stored one', () => {
  const { service, store } = setup(new MemoryAppearanceStore(), new FakeMedia(), {
    instance: plumInstance,
    allowStoredInstance: true,
  });
  service.setInstance(sharpInstance);
  service.resetInstance();
  expect(service.instance()).toEqual(plumInstance);
  expect(store.instance).toBeNull();
});

it('resets everything personal to the defaults', () => {
  const { service, store } = setup();
  service.setPersonal({ mode: 'dark', contrast: 'high', colors: plum });
  service.resetPersonal();
  expect(service.personal()).toEqual(DEFAULT_PERSONAL_APPEARANCE);
  expect(store.personal).toBeNull();
});

it('exposes instance and personal read-only', () => {
  const { service } = setup();
  expect('set' in service.instance).toBe(false);
  expect('set' in service.personal).toBe(false);
});

it('follows changes another tab stored', () => {
  const { service, store } = setup();
  store.personal = { mode: 'dark', contrast: 'standard' };
  store.emit('personal');
  TestBed.tick();
  expect(service.personal()).toEqual({ mode: 'dark', contrast: 'standard' });
  expect(document.documentElement.style.colorScheme).toBe('dark');
});

it('caches both contrast levels while the contrast follows the system', () => {
  const { store } = setup();
  const expected = (mode: 'light' | 'dark', contrast: 'standard' | 'high') =>
    computeThemeVars({ ...base, mode, contrast })['--mat-sys-primary'];
  expect(store.boot).toMatchObject({ v: 2, mode: 'system', followsSystemContrast: true });
  expect(store.boot?.light['--mat-sys-primary']).toBe(expected('light', 'standard'));
  expect(store.boot?.darkHigh?.['--mat-sys-primary']).toBe(expected('dark', 'high'));
});

it('keeps standard contrast in the cache while the system currently asks for more', () => {
  const media = new FakeMedia();
  media.state['(prefers-contrast: more)'] = true;
  const { store } = setup(new MemoryAppearanceStore(), media);
  expect(rootVar('--mat-sys-on-surface-variant')).toBe(
    computeThemeVars({ ...base, mode: 'light', contrast: 'high' })['--mat-sys-on-surface-variant'],
  );
  expect(store.boot?.light['--mat-sys-on-surface-variant']).toBe(
    computeThemeVars({ ...base, mode: 'light', contrast: 'standard' })[
      '--mat-sys-on-surface-variant'
    ],
  );
});

it('caches only the chosen contrast when the user picked one', () => {
  const { service, store } = setup();
  service.setPersonal({ mode: 'dark', contrast: 'medium' });
  TestBed.tick();
  expect(store.boot).toMatchObject({ v: 2, mode: 'dark', followsSystemContrast: false });
  expect(store.boot?.lightHigh).toBeUndefined();
  expect(store.boot?.dark['--mat-sys-primary']).toBe(
    computeThemeVars({ ...base, mode: 'dark', contrast: 'medium' })['--mat-sys-primary'],
  );
});
```

(`DEFAULT_PERSONAL_APPEARANCE` und `InstanceAppearance` in den Contracts-Import aufnehmen; der bestehende Test „starts from stored settings“ verwendet `new MemoryAppearanceStore()`.)

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: FAIL – `provideTheme` kennt `allowStoredInstance` nicht, `resetPersonal`/`resetInstance` fehlen, Boot-Cache ohne `v`.

- [ ] **Step 6: ThemeService umsetzen**

`apps/frontend/projects/ui/src/lib/theme/instance-appearance.token.ts` vollständig:

```ts
import { InjectionToken } from '@angular/core';
import { DEFAULT_INSTANCE_APPEARANCE, type InstanceAppearance } from '@smart/contracts';

/** Instance default of this installation: config.json if the hoster set one, else the build default. */
export const INSTANCE_APPEARANCE = new InjectionToken<InstanceAppearance>('INSTANCE_APPEARANCE', {
  providedIn: 'root',
  factory: () => DEFAULT_INSTANCE_APPEARANCE,
});

/**
 * Whether a browser-stored instance theme may override the default (spec 4.5): only while the
 * instance appearance editor is enabled, so a forgotten local edit cannot hide the hoster's default.
 */
export const STORED_INSTANCE_ALLOWED = new InjectionToken<boolean>('STORED_INSTANCE_ALLOWED', {
  providedIn: 'root',
  factory: () => false,
});
```

`apps/frontend/projects/ui/src/lib/theme/provide-theme.ts` vollständig:

```ts
import {
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import type { InstanceAppearance } from '@smart/contracts';
import { INSTANCE_APPEARANCE, STORED_INSTANCE_ALLOWED } from './instance-appearance.token';
import { ThemeService } from './theme.service';

export interface ThemeOptions {
  /** Instance default from the runtime config; without it the build default applies. */
  readonly instance?: InstanceAppearance;
  /** True while the instance appearance editor is enabled (runtime config). */
  readonly allowStoredInstance?: boolean;
}

/** Starts the ThemeService with the app so the theme applies on boot. */
export function provideTheme(options: ThemeOptions = {}): EnvironmentProviders {
  return makeEnvironmentProviders([
    ...(options.instance ? [{ provide: INSTANCE_APPEARANCE, useValue: options.instance }] : []),
    { provide: STORED_INSTANCE_ALLOWED, useValue: options.allowStoredInstance ?? false },
    provideEnvironmentInitializer(() => {
      inject(ThemeService);
    }),
  ]);
}
```

`apps/frontend/projects/ui/src/lib/theme/theme.service.ts` vollständig:

```ts
import { DOCUMENT, DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  DEFAULT_PERSONAL_APPEARANCE,
  instanceAppearanceSchema,
  personalAppearanceSchema,
  type InstanceAppearance,
  type PersonalAppearance,
} from '@smart/contracts';
import {
  computeThemeVars,
  resolveAppearance,
  type ResolvedContrast,
  type ResolvedMode,
} from '@smart/theme';
import { APPEARANCE_STORE, BOOT_CACHE_VERSION } from './appearance-store';
import { applyThemeVars } from './apply-theme';
import { INSTANCE_APPEARANCE, STORED_INSTANCE_ALLOWED } from './instance-appearance.token';
import { MEDIA_QUERIES } from './media-queries';

const DARK = '(prefers-color-scheme: dark)';
const MORE_CONTRAST = '(prefers-contrast: more)';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly store = inject(APPEARANCE_STORE);
  private readonly media = inject(MEDIA_QUERIES);
  private readonly defaultInstance = inject(INSTANCE_APPEARANCE);
  private readonly storedInstanceAllowed = inject(STORED_INSTANCE_ALLOWED);

  private readonly instanceState = signal<InstanceAppearance>(this.loadInstance());
  private readonly personalState = signal<PersonalAppearance>(this.loadPersonal());
  readonly instance = this.instanceState.asReadonly();
  readonly personal = this.personalState.asReadonly();
  private readonly prefersDark = signal(this.media.matches(DARK));
  private readonly prefersMoreContrast = signal(this.media.matches(MORE_CONTRAST));

  readonly resolved = computed(() =>
    resolveAppearance(this.instance(), this.personal(), {
      prefersDark: this.prefersDark(),
      prefersMoreContrast: this.prefersMoreContrast(),
    }),
  );

  constructor() {
    const stopDark = this.media.listen(DARK, (matches) => this.prefersDark.set(matches));
    const stopContrast = this.media.listen(MORE_CONTRAST, (matches) =>
      this.prefersMoreContrast.set(matches),
    );
    // Another tab stored a change: follow it so all open tabs look the same.
    const stopWatching = this.store.watch((key) =>
      key === 'instance'
        ? this.instanceState.set(this.loadInstance())
        : this.personalState.set(this.loadPersonal()),
    );
    inject(DestroyRef).onDestroy(() => {
      stopDark();
      stopContrast();
      stopWatching();
    });
    effect(() => this.apply());
  }

  setPersonal(value: PersonalAppearance): void {
    const parsed = personalAppearanceSchema.parse(value);
    this.personalState.set(parsed);
    this.store.savePersonal(parsed);
  }

  /** Back to the defaults: instance colors, system mode and contrast. */
  resetPersonal(): void {
    this.personalState.set(DEFAULT_PERSONAL_APPEARANCE);
    this.store.clearPersonal();
  }

  resetPersonalColors(): void {
    const { mode, contrast } = this.personal();
    this.setPersonal({ mode, contrast });
  }

  setInstance(value: InstanceAppearance): void {
    const parsed = instanceAppearanceSchema.parse(value);
    this.instanceState.set(parsed);
    if (this.storedInstanceAllowed) this.store.saveInstance(parsed);
  }

  /** Back to the installation default (config.json, else the build default). */
  resetInstance(): void {
    this.instanceState.set(this.defaultInstance);
    this.store.clearInstance();
  }

  /** Precedence (spec 4.5): stored instance (only while the editor is on), config.json, build default. */
  private loadInstance(): InstanceAppearance {
    return (this.storedInstanceAllowed ? this.store.loadInstance() : null) ?? this.defaultInstance;
  }

  private loadPersonal(): PersonalAppearance {
    return this.store.loadPersonal() ?? DEFAULT_PERSONAL_APPEARANCE;
  }

  private apply(): void {
    const resolved = this.resolved();
    const vars = (mode: ResolvedMode, contrast: ResolvedContrast) =>
      computeThemeVars({ ...resolved, mode, contrast });
    applyThemeVars(
      this.document.documentElement,
      vars(resolved.mode, resolved.contrast),
      resolved.mode,
    );
    const { mode, contrast } = this.personal();
    const followsSystemContrast = contrast === 'system';
    const cached = followsSystemContrast ? 'standard' : resolved.contrast;
    this.store.saveBootCache({
      v: BOOT_CACHE_VERSION,
      mode,
      followsSystemContrast,
      light: vars('light', cached),
      dark: vars('dark', cached),
      ...(followsSystemContrast
        ? { lightHigh: vars('light', 'high'), darkHigh: vars('dark', 'high') }
        : {}),
    });
  }
}
```

`public-api.ts`: den Export von `./lib/theme/appearance-store` ergänzen um `BOOT_CACHE_VERSION` und `type AppearanceKey`; neu `export { MemoryAppearanceStore } from './lib/theme/memory-appearance-store';`, im Token-Export `STORED_INSTANCE_ALLOWED` ergänzen und `export { provideTheme, type ThemeOptions } from './lib/theme/provide-theme';`.

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: PASS.

- [ ] **Step 7: Failing tests – theme-boot.js**

In `apps/frontend/src/app/theme-boot.spec.ts`:

- Alle bestehenden gültigen Caches bekommen `v: 2, followsSystemContrast: false`; die Liste „ignores unusable cache“ wird um `'{"mode":"dark","light":{},"dark":{"--mat-sys-surface":"#101415"}}'` (alter Cache ohne Version) und `'{"v":1,"mode":"dark","followsSystemContrast":false,"light":{},"dark":{"--mat-sys-surface":"#101415"}}'` ergänzt.
- `stubMatchMedia` wird verallgemeinert und an den Anfang der Datei gezogen:

```ts
const stubMatchMedia = (matching: { dark?: boolean; moreContrast?: boolean }) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches:
        (query.includes('prefers-color-scheme: dark') && !!matching.dark) ||
        (query.includes('prefers-contrast: more') && !!matching.moreContrast),
    }),
  });
};
```

(bestehende Aufrufe: `stubMatchMedia(true)` → `stubMatchMedia({ dark: true })`, `stubMatchMedia(false)` → `stubMatchMedia({})`; das `afterEach` mit `Reflect.deleteProperty(window, 'matchMedia')` gilt für die ganze Datei.)

- Neuer Block:

```ts
describe('with contrast following the system', () => {
  const cache = JSON.stringify({
    v: 2,
    mode: 'light',
    followsSystemContrast: true,
    light: { '--mat-sys-outline': '#6f7979' },
    dark: { '--mat-sys-outline': '#899393' },
    lightHigh: { '--mat-sys-outline': '#293233' },
    darkHigh: { '--mat-sys-outline': '#e9f2f3' },
  });

  it('applies the high contrast variables when the system asks for more contrast', () => {
    stubMatchMedia({ moreContrast: true });
    localStorage.setItem('smart.theme.boot', cache);
    run();
    expect(root().getPropertyValue('--mat-sys-outline')).toBe('#293233');
  });

  it('applies the standard variables otherwise', () => {
    stubMatchMedia({});
    localStorage.setItem('smart.theme.boot', cache);
    run();
    expect(root().getPropertyValue('--mat-sys-outline')).toBe('#6f7979');
  });

  it('applies nothing when the high contrast variables are missing', () => {
    stubMatchMedia({ moreContrast: true });
    localStorage.setItem(
      'smart.theme.boot',
      JSON.stringify({ ...JSON.parse(cache), lightHigh: undefined }),
    );
    run();
    expect(root().getPropertyValue('--mat-sys-outline')).toBe('');
    expect(root().colorScheme).toBe('');
  });
});
```

Run: `pnpm --filter @smart/frontend exec ng test frontend --watch=false`
Expected: FAIL – das Skript wendet Caches ohne Version an und kennt die Kontraststufen nicht.

- [ ] **Step 8: theme-boot.js umsetzen**

`apps/frontend/public/theme-boot.js` vollständig:

```js
// Applies the user's last theme before Angular starts (no flash). External file: the CSP forbids
// inline scripts. Format: BootCache in projects/ui/src/lib/theme/appearance-store.ts (version 2).
(function () {
  try {
    var cache = JSON.parse(localStorage.getItem('smart.theme.boot') || 'null');
    if (!cache || cache.v !== 2) return;
    var dark =
      cache.mode === 'dark' ||
      (cache.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var high =
      cache.followsSystemContrast === true && window.matchMedia('(prefers-contrast: more)').matches;
    var vars = high ? (dark ? cache.darkHigh : cache.lightHigh) : dark ? cache.dark : cache.light;
    if (!vars || typeof vars !== 'object') return;
    var style = document.documentElement.style;
    var applied = 0;
    for (var name in vars) {
      if (name.indexOf('--') === 0 && typeof vars[name] === 'string') {
        style.setProperty(name, vars[name]);
        applied++;
      }
    }
    // Without variables the default theme stays, so its color scheme must stay too.
    if (applied > 0) style.colorScheme = dark ? 'dark' : 'light';
  } catch {
    // Storage unavailable or corrupt: the build-time default theme applies.
  }
})();
```

Run: `pnpm --filter @smart/frontend exec ng test frontend --watch=false`
Expected: PASS.

- [ ] **Step 9: E2E-Caches auf Version 2**

In `tests/e2e/specs/stack-smoke.spec.ts` erhalten die beiden Tests „a stored dark theme applies even before the app bundle runs“ und „a system-mode cache follows the browser color scheme …“ im gespeicherten Cache zusätzlich `v: 2, followsSystemContrast: false`.

Run: `sh infra/compose/test/stack-test.sh`
Expected: PASS.

- [ ] **Step 10: Prüfen und committen**

Run: Prüfung am Ende der Task (Global Constraints) und `pnpm --filter @smart/theme test`.

```bash
git add packages/theme apps/frontend tests/e2e
git commit -m "feat(ui): apply the instance theme precedence and sync the theme across tabs"
```

---

### Task 4: Storybook-Werkzeugleiste über ThemeService und Sprache

**Files:**

- Create: `apps/frontend/projects/ui/src/lib/testing/storybook-environment.ts`
- Modify: `apps/frontend/.storybook/preview.ts`, `apps/frontend/.storybook/test-runner.ts`
- Modify: `apps/frontend/projects/ui/src/lib/theme/color-roles.stories.ts`

**Interfaces:**

- Consumes: `ThemeService`, `provideTheme`, `APPEARANCE_STORE`, `MemoryAppearanceStore` (Task 3); `loadUiTranslation` (Task 2); `LANGUAGES`, `DEFAULT_LANGUAGE`, `languageSchema` aus `@smart/contracts`.
- Produces (nur Storybook): `withToolbarGlobals: Decorator`, `provideStorybookEnvironment(): EnvironmentProviders`, `type ToolbarGlobals`.
- Produces: Werkzeugleisten-Eintrag `locale` (`de`/`en`); zweiter Prüfdurchlauf mit `mode:dark;contrast:high;seed:!hex(8a5a00);locale:en`.

Ablauf: Der Decorator `withToolbarGlobals` legt bei jedem Rendern die Auswahl der Werkzeugleiste in ein Signal. Die Story-App startet mit `provideStorybookEnvironment()`. Ein Effekt in ihrem Environment-Initializer überträgt das Signal auf `ThemeService.setInstance`/`setPersonal` und `TranslocoService.setActiveLang` und setzt `<html lang>`. So nutzt Storybook denselben `ThemeService` wie die App (Spec 9), mit einem Speicher im Arbeitsspeicher.

- [ ] **Step 1: Failing test – Story prüft Theme und Sprache aus der Werkzeugleiste**

In `apps/frontend/projects/ui/src/lib/theme/color-roles.stories.ts` den Anfang von `expectThemeApplied` ersetzen: Der Vergleich der Primärfarbe wartet (der ThemeService wendet das Theme in einem Effekt an), und die Seitensprache wird geprüft.

```ts
const expectThemeApplied = async ({ globals, canvas }: StoryContext): Promise<void> => {
  const resolved = {
    colors: {
      seed: globals['seed'],
      variant: globals['variant'],
      colorMatch: false,
      coreOverrides: {},
    },
    shape: globals['shape'],
    font: globals['font'],
    mode: globals['mode'],
    contrast: globals['contrast'],
  } as ResolvedAppearance;
  const expected = computeThemeVars(resolved);
  await waitFor(() =>
    expect(
      getComputedStyle(document.documentElement).getPropertyValue('--mat-sys-primary').trim(),
    ).toBe(expected['--mat-sys-primary']),
  );
  await expect(document.documentElement.lang).toBe(globals['locale']);
  // … Rest der Funktion unverändert (Anzahl der Kacheln, on-primary auf primary)
```

`waitFor` in den Import aus `storybook/test` aufnehmen. Die Story `DunkelHoherKontrast` bekommt zusätzlich `locale: 'en'` in ihren `globals`.

Run: `pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci`
Expected: FAIL in `Grundlagen/Farbrollen` – `document.documentElement.lang` ist nicht `de`/`en` (die Werkzeugleiste kennt `locale` noch nicht).

- [ ] **Step 2: Storybook-Umgebung umsetzen**

`apps/frontend/projects/ui/src/lib/testing/storybook-environment.ts`:

```ts
import {
  DOCUMENT,
  Injectable,
  effect,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  signal,
  type EnvironmentProviders,
} from '@angular/core';
import {
  TranslocoService,
  provideTransloco,
  type Translation,
  type TranslocoLoader,
} from '@jsverse/transloco';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  languageSchema,
  type Language,
  type ThemeFont,
  type ThemeShape,
  type ThemeVariant,
} from '@smart/contracts';
import type { Decorator } from '@storybook/angular';
import { loadUiTranslation } from '../i18n/ui-translations';
import { APPEARANCE_STORE } from '../theme/appearance-store';
import { MemoryAppearanceStore } from '../theme/memory-appearance-store';
import { provideTheme } from '../theme/provide-theme';
import { ThemeService } from '../theme/theme.service';

/** The toolbar selection (`globalTypes` in .storybook/preview.ts). */
export interface ToolbarGlobals {
  readonly seed: string;
  readonly variant: ThemeVariant;
  readonly mode: 'light' | 'dark';
  readonly contrast: 'standard' | 'medium' | 'high';
  readonly shape: ThemeShape;
  readonly font: ThemeFont;
  readonly locale: Language;
}

const toolbar = signal<ToolbarGlobals | null>(null);

/** Hands the toolbar selection to the story's app on every render. */
export const withToolbarGlobals: Decorator = (story, context) => {
  toolbar.set(context.globals as ToolbarGlobals);
  return story();
};

@Injectable({ providedIn: 'root' })
class StorybookTranslationLoader implements TranslocoLoader {
  getTranslation(lang: string): Promise<Translation> {
    const parsed = languageSchema.safeParse(lang);
    return loadUiTranslation(parsed.success ? parsed.data : DEFAULT_LANGUAGE);
  }
}

/** The app's theme and language machinery for stories, driven by the toolbar instead of storage. */
export function provideStorybookEnvironment(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideTheme(),
    { provide: APPEARANCE_STORE, useFactory: () => new MemoryAppearanceStore() },
    ...provideTransloco({
      config: {
        availableLangs: [...LANGUAGES],
        defaultLang: DEFAULT_LANGUAGE,
        reRenderOnLangChange: true,
        prodMode: true,
      },
      loader: StorybookTranslationLoader,
    }),
    provideEnvironmentInitializer(() => {
      const theme = inject(ThemeService);
      const transloco = inject(TranslocoService);
      const html = inject(DOCUMENT).documentElement;
      effect(() => {
        const globals = toolbar();
        if (!globals) return;
        theme.setInstance({
          colors: {
            seed: globals.seed,
            variant: globals.variant,
            colorMatch: false,
            coreOverrides: {},
          },
          shape: globals.shape,
          font: globals.font,
        });
        theme.setPersonal({ mode: globals.mode, contrast: globals.contrast });
        transloco.setActiveLang(globals.locale);
        html.lang = globals.locale;
      });
    }),
  ]);
}
```

`apps/frontend/.storybook/preview.ts` vollständig:

```ts
import {
  DEFAULT_INSTANCE_APPEARANCE,
  DEFAULT_LANGUAGE,
  THEME_CONTRASTS,
  THEME_FONTS,
  THEME_MODES,
  THEME_SHAPES,
  THEME_VARIANTS,
} from '@smart/contracts';
import { applicationConfig, type Preview } from '@storybook/angular';
import {
  provideStorybookEnvironment,
  withToolbarGlobals,
} from '../projects/ui/src/lib/testing/storybook-environment';

const toolbar = (title: string, items: readonly (string | { value: string; title: string })[]) => ({
  description: title,
  toolbar: { title, items: [...items], dynamicTitle: true },
});

/** Theme and language come from the same ThemeService and Transloco setup the app uses (spec 9). */
const preview: Preview = {
  decorators: [
    withToolbarGlobals,
    applicationConfig({ providers: [provideStorybookEnvironment()] }),
  ],
  globalTypes: {
    seed: toolbar('Grundfarbe', [
      { value: '#00687a', title: 'Petrol' },
      { value: '#4c6b3d', title: 'Moos' },
      { value: '#3e5f90', title: 'Schieferblau' },
      { value: '#8a5a00', title: 'Bernstein' },
      { value: '#6e4c7e', title: 'Pflaume' },
      { value: '#5d5f63', title: 'Graphit' },
    ]),
    variant: toolbar('Variante', THEME_VARIANTS),
    mode: toolbar(
      'Modus',
      THEME_MODES.filter((mode) => mode !== 'system'),
    ),
    contrast: toolbar(
      'Kontrast',
      THEME_CONTRASTS.filter((contrast) => contrast !== 'system'),
    ),
    shape: toolbar('Formen', THEME_SHAPES),
    font: toolbar('Schrift', THEME_FONTS),
    locale: toolbar('Sprache', [
      { value: 'de', title: 'Deutsch' },
      { value: 'en', title: 'English' },
    ]),
  },
  initialGlobals: {
    seed: DEFAULT_INSTANCE_APPEARANCE.colors.seed,
    variant: DEFAULT_INSTANCE_APPEARANCE.colors.variant,
    mode: 'light',
    contrast: 'standard',
    shape: DEFAULT_INSTANCE_APPEARANCE.shape,
    font: DEFAULT_INSTANCE_APPEARANCE.font,
    locale: DEFAULT_LANGUAGE,
  },
};
export default preview;
```

In `apps/frontend/.storybook/test-runner.ts` den zweiten Durchlauf erweitern:

```ts
/** A second, demanding theme: every story is also checked dark, high contrast, amber seed, English. */
const SECOND_THEME = 'mode:dark;contrast:high;seed:!hex(8a5a00);locale:en';
```

Run: `pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci`
Expected: PASS für alle Stories in beiden Durchläufen. Stories mit eigenem `applicationConfig` (Snackbar) bleiben grün: Storybook führt die Provider beider Ebenen zusammen. Falls eine Story nun vor dem Anwenden des Themes geprüft wird (axe meldet Kontrastfehler nur im zweiten Durchlauf), wartet der zweite Durchlauf bereits auf das Ende der `play`-Funktion; dann `waitFor` wie in Step 1 in der betroffenen `play`-Funktion ergänzen und als Ruling festhalten.

- [ ] **Step 3: Prüfen und committen**

Run: Prüfung am Ende der Task (Global Constraints) einschließlich der Storybook-Prüfung.

```bash
git add apps/frontend/.storybook apps/frontend/projects/ui/src/lib/testing apps/frontend/projects/ui/src/lib/theme/color-roles.stories.ts
git commit -m "feat(ui): drive the Storybook toolbar through the ThemeService and add the language"
```

---

### Task 5: Laufzeitkonfiguration `config.json`

**Files:**

- Create: `packages/contracts/src/runtime-config.ts`, `packages/contracts/src/runtime-config.spec.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/frontend/src/app/core/config/index.ts`, `runtime-config.ts`, `runtime-config.spec.ts`
- Modify: `apps/frontend/src/app/app.config.ts`, `apps/frontend/src/main.ts`
- Create: `apps/frontend/src/app/app.config.spec.ts`
- Create: `apps/frontend/public/config.json`
- Create: `apps/frontend/nginx/40-smart-config.sh`
- Modify: `apps/frontend/nginx/default.conf`, `apps/frontend/Dockerfile`
- Modify: `infra/compose/compose.yaml`, `infra/compose/.env.example`, `infra/compose/test/compose.test.yaml`
- Modify: `tests/e2e/specs/stack-smoke.spec.ts`
- Modify: `docs/runbooks/provisioning.md`, `docs/superpowers/specs/2026-10-11-etappe-3-design-system-design.md`

**Interfaces:**

- Consumes: `provideTheme({ instance, allowStoredInstance })` (Task 3), `provideI18n()` (Task 2).
- Produces (`@smart/contracts`): `interface RuntimeConfig { features: { instanceAppearanceEditor: boolean }; instanceAppearance?: InstanceAppearance }`, `DEFAULT_RUNTIME_CONFIG`, `parseRuntimeConfig(raw: unknown): RuntimeConfig`.
- Produces (App, `core/config/index.ts`): `RUNTIME_CONFIG: InjectionToken<RuntimeConfig>`, `loadRuntimeConfig(fetchFn?, timeoutMs?): Promise<RuntimeConfig>`, `provideRuntimeConfig(config): Provider`.
- Produces (App): `createAppConfig(config?: RuntimeConfig): ApplicationConfig` in `app.config.ts` (ersetzt die Konstante `appConfig`).
- Produces (Container): `/config.json`, erzeugt beim Start aus `SMART_INSTANCE_APPEARANCE_EDITOR` und `SMART_INSTANCE_APPEARANCE`; 3d nutzt `RUNTIME_CONFIG.features.instanceAppearanceEditor` für die Sichtbarkeit der Installations-Einstellungen.

- [ ] **Step 1: Failing test – Parser**

`packages/contracts/src/runtime-config.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_INSTANCE_APPEARANCE, type InstanceAppearance } from './appearance.js';
import { DEFAULT_RUNTIME_CONFIG, parseRuntimeConfig } from './runtime-config.js';

const plum: InstanceAppearance = {
  ...DEFAULT_INSTANCE_APPEARANCE,
  colors: { ...DEFAULT_INSTANCE_APPEARANCE.colors, seed: '#6e4c7e' },
};

describe('parseRuntimeConfig', () => {
  it('reads features and the instance appearance', () => {
    expect(
      parseRuntimeConfig({
        features: { instanceAppearanceEditor: true },
        instanceAppearance: plum,
      }),
    ).toEqual({ features: { instanceAppearanceEditor: true }, instanceAppearance: plum });
  });

  it('leaves the instance appearance out when none is set', () => {
    expect(parseRuntimeConfig({ features: { instanceAppearanceEditor: false } })).toEqual({
      features: { instanceAppearanceEditor: false },
    });
  });

  it('keeps the features when only the instance appearance is invalid', () => {
    expect(
      parseRuntimeConfig({
        features: { instanceAppearanceEditor: true },
        instanceAppearance: { colors: { seed: 'petrol' } },
      }),
    ).toEqual({ features: { instanceAppearanceEditor: true } });
  });

  it('keeps the instance appearance when only the features are invalid', () => {
    expect(
      parseRuntimeConfig({
        features: { instanceAppearanceEditor: 'true' },
        instanceAppearance: plum,
      }),
    ).toEqual({ ...DEFAULT_RUNTIME_CONFIG, instanceAppearance: plum });
  });

  it.each([null, 42, 'config', []])('falls back to the defaults for %j', (raw) => {
    expect(parseRuntimeConfig(raw)).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it('keeps the instance appearance editor off by default', () => {
    expect(DEFAULT_RUNTIME_CONFIG.features.instanceAppearanceEditor).toBe(false);
  });
});
```

Run: `pnpm --filter @smart/contracts test`
Expected: FAIL – `./runtime-config.js` nicht gefunden.

- [ ] **Step 2: Parser umsetzen**

`packages/contracts/src/runtime-config.ts`:

```ts
import * as z from 'zod/mini';
import { instanceAppearanceSchema, type InstanceAppearance } from './appearance.js';

/** Served as /config.json by the web container, written from SMART_* environment variables. */
export interface RuntimeConfig {
  readonly features: { readonly instanceAppearanceEditor: boolean };
  /** Instance default set by the hoster; overrides the build default (spec 4.5). */
  readonly instanceAppearance?: InstanceAppearance;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  features: { instanceAppearanceEditor: false },
};

const featuresSchema = z.object({ instanceAppearanceEditor: z.boolean() });

/** Lenient: each invalid part falls back on its own, so one typo cannot switch everything off. */
export function parseRuntimeConfig(raw: unknown): RuntimeConfig {
  const record =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const features = featuresSchema.safeParse(record['features']);
  const appearance = instanceAppearanceSchema.safeParse(record['instanceAppearance']);
  return {
    features: features.success ? features.data : DEFAULT_RUNTIME_CONFIG.features,
    ...(appearance.success ? { instanceAppearance: appearance.data } : {}),
  };
}
```

In `packages/contracts/src/index.ts` ergänzen: `export * from './runtime-config.js';`

Run: `pnpm --filter @smart/contracts test && pnpm packages:build`
Expected: PASS.

- [ ] **Step 3: Failing test – Laden vor dem Start**

`apps/frontend/src/app/core/config/runtime-config.spec.ts`:

```ts
import { DEFAULT_INSTANCE_APPEARANCE, DEFAULT_RUNTIME_CONFIG } from '@smart/contracts';
import { loadRuntimeConfig } from './runtime-config';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('loadRuntimeConfig', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('reads config.json without the HTTP cache', async () => {
    const fetchFn = vi.fn(() =>
      json({
        features: { instanceAppearanceEditor: true },
        instanceAppearance: DEFAULT_INSTANCE_APPEARANCE,
      }),
    );
    await expect(loadRuntimeConfig(fetchFn)).resolves.toEqual({
      features: { instanceAppearanceEditor: true },
      instanceAppearance: DEFAULT_INSTANCE_APPEARANCE,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'config.json',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('falls back to the defaults when config.json is missing', async () => {
    await expect(loadRuntimeConfig(() => json({}, 404))).resolves.toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it('falls back to the defaults when config.json is not JSON', async () => {
    const fetchFn = () => Promise.resolve(new Response('{"features":', { status: 200 }));
    await expect(loadRuntimeConfig(fetchFn)).resolves.toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it('falls back to the defaults when the network fails', async () => {
    await expect(
      loadRuntimeConfig(() => Promise.reject(new TypeError('offline'))),
    ).resolves.toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it('gives up after the timeout instead of delaying the app start', async () => {
    const hanging = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
      );
    await expect(loadRuntimeConfig(hanging, 20)).resolves.toEqual(DEFAULT_RUNTIME_CONFIG);
  });
});
```

`apps/frontend/src/app/app.config.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { DEFAULT_INSTANCE_APPEARANCE, type InstanceAppearance } from '@smart/contracts';
import { APPEARANCE_STORE, MemoryAppearanceStore, ThemeService } from '@smart/ui';
import { createAppConfig } from './app.config';
import { RUNTIME_CONFIG } from './core/config';

const plum: InstanceAppearance = {
  ...DEFAULT_INSTANCE_APPEARANCE,
  colors: { ...DEFAULT_INSTANCE_APPEARANCE.colors, seed: '#6e4c7e' },
};

function setup(config: Parameters<typeof createAppConfig>[0], store = new MemoryAppearanceStore()) {
  TestBed.configureTestingModule({
    providers: [
      ...createAppConfig(config).providers,
      { provide: APPEARANCE_STORE, useValue: store },
    ],
  });
  return TestBed.inject(ThemeService);
}

describe('createAppConfig', () => {
  afterEach(() => document.documentElement.removeAttribute('style'));

  it('provides the runtime config and its instance default to the theme', () => {
    const config = { features: { instanceAppearanceEditor: false }, instanceAppearance: plum };
    const theme = setup(config);
    expect(TestBed.inject(RUNTIME_CONFIG)).toBe(config);
    expect(theme.instance()).toEqual(plum);
  });

  it('lets a stored instance theme win only while the instance editor is on', () => {
    const stored = new MemoryAppearanceStore();
    stored.instance = { ...plum, shape: 'kantig' };
    const theme = setup(
      { features: { instanceAppearanceEditor: true }, instanceAppearance: plum },
      stored,
    );
    expect(theme.instance().shape).toBe('kantig');
  });
});
```

Run: `pnpm --filter @smart/frontend exec ng test frontend --watch=false`
Expected: FAIL – `./core/config` und `createAppConfig` fehlen.

- [ ] **Step 4: Laden umsetzen und verdrahten**

`apps/frontend/src/app/core/config/runtime-config.ts`:

```ts
import { InjectionToken, type Provider } from '@angular/core';
import { DEFAULT_RUNTIME_CONFIG, parseRuntimeConfig, type RuntimeConfig } from '@smart/contracts';

export const RUNTIME_CONFIG = new InjectionToken<RuntimeConfig>('RUNTIME_CONFIG', {
  providedIn: 'root',
  factory: () => DEFAULT_RUNTIME_CONFIG,
});

export function provideRuntimeConfig(config: RuntimeConfig): Provider {
  return { provide: RUNTIME_CONFIG, useValue: config };
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Fetches config.json (relative to <base href>) before the app starts. Any failure – missing,
 * not JSON, offline, slow – falls back to the defaults, because the app must start regardless.
 */
export async function loadRuntimeConfig(
  fetchFn: FetchFn = (input, init) => globalThis.fetch(input, init),
  timeoutMs = 3000,
): Promise<RuntimeConfig> {
  try {
    const response = await fetchFn('config.json', {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return DEFAULT_RUNTIME_CONFIG;
    return parseRuntimeConfig(await response.json());
  } catch (error) {
    console.warn('config.json unavailable, using the defaults', error);
    return DEFAULT_RUNTIME_CONFIG;
  }
}
```

`apps/frontend/src/app/core/config/index.ts`:

```ts
export { RUNTIME_CONFIG, loadRuntimeConfig, provideRuntimeConfig } from './runtime-config';
```

`apps/frontend/src/app/app.config.ts` vollständig:

```ts
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig } from '@smart/contracts';
import { provideTheme } from '@smart/ui';
import { routes } from './app.routes';
import { provideRuntimeConfig } from './core/config';
import { provideI18n } from './core/i18n';

export function createAppConfig(config: RuntimeConfig = DEFAULT_RUNTIME_CONFIG): ApplicationConfig {
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      provideRouter(routes),
      provideRuntimeConfig(config),
      provideI18n(),
      provideTheme({
        instance: config.instanceAppearance,
        allowStoredInstance: config.features.instanceAppearanceEditor,
      }),
    ],
  };
}
```

`apps/frontend/src/main.ts` vollständig:

```ts
import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { createAppConfig } from './app/app.config';
import { loadRuntimeConfig } from './app/core/config';

loadRuntimeConfig()
  .then((config) => bootstrapApplication(App, createAppConfig(config)))
  .catch((err) => console.error(err));
```

`apps/frontend/public/config.json` (nur für `ng serve` und Storybook; der Container liefert unter derselben URL seine eigene Datei aus):

```json
{
  "features": { "instanceAppearanceEditor": true }
}
```

Run: `pnpm --filter @smart/frontend test`
Expected: PASS.

- [ ] **Step 5: Container erzeugt config.json**

`apps/frontend/nginx/40-smart-config.sh`:

```sh
#!/bin/sh
# Writes the runtime configuration served as /config.json from SMART_* environment variables.
# Runs as the unprivileged nginx user from /docker-entrypoint.d/ before nginx starts.
set -eu

target="${SMART_CONFIG_TARGET:-/tmp/smart-config.json}"

case "${SMART_INSTANCE_APPEARANCE_EDITOR:-false}" in
  true) editor=true ;;
  *) editor=false ;;
esac

# SMART_INSTANCE_APPEARANCE is JSON (instanceAppearanceSchema). The app validates it and falls
# back to the build default if it is invalid; broken JSON makes the whole file fall back.
appearance="${SMART_INSTANCE_APPEARANCE:-}"
if [ -n "$appearance" ]; then
  printf '{"features":{"instanceAppearanceEditor":%s},"instanceAppearance":%s}\n' \
    "$editor" "$appearance" > "$target"
else
  printf '{"features":{"instanceAppearanceEditor":%s}}\n' "$editor" > "$target"
fi
```

Ausführbar machen: `chmod +x apps/frontend/nginx/40-smart-config.sh` (Git speichert das Bit).

`apps/frontend/Dockerfile`, im zweiten Stage nach den beiden nginx-`COPY`-Zeilen:

```dockerfile
COPY --chmod=755 apps/frontend/nginx/40-smart-config.sh /docker-entrypoint.d/40-smart-config.sh
```

`apps/frontend/nginx/default.conf`, vor `location = /theme-boot.js` einfügen:

```nginx
  # Runtime configuration, written at container start from SMART_* variables (40-smart-config.sh).
  # Never cached: a changed setting must reach every browser on its next start.
  location = /config.json {
    alias /tmp/smart-config.json;
    default_type application/json;
    add_header Cache-Control "no-store" always;
    include /etc/nginx/snippets/security-headers.conf;
  }
```

`infra/compose/compose.yaml`, Dienst `web`, nach `tmpfs`:

<!-- prettier-ignore -->
```yaml
    environment:
      SMART_INSTANCE_APPEARANCE_EDITOR: ${SMART_INSTANCE_APPEARANCE_EDITOR:-false}
      SMART_INSTANCE_APPEARANCE: ${SMART_INSTANCE_APPEARANCE:-}
```

`infra/compose/.env.example`, nach `MQTT_API_PASSWORD`:

```sh

# Web app runtime configuration (served as /config.json, see docs/runbooks/provisioning.md).
# Staging shows the instance appearance editor; production leaves it off until the admin role (stage 4).
SMART_INSTANCE_APPEARANCE_EDITOR=true
# Optional instance default theme as JSON, for example:
# SMART_INSTANCE_APPEARANCE={"colors":{"seed":"#6e4c7e","variant":"tonalSpot","colorMatch":false,"coreOverrides":{}},"shape":"standard","font":"roboto-flex"}
```

`infra/compose/test/compose.test.yaml`, Dienst `web`, nach `ports`:

<!-- prettier-ignore -->
```yaml
    environment:
      SMART_INSTANCE_APPEARANCE_EDITOR: 'true'
      # Must match STACK_TEST_INSTANCE in tests/e2e/specs/stack-smoke.spec.ts.
      SMART_INSTANCE_APPEARANCE: '{"colors":{"seed":"#6e4c7e","variant":"tonalSpot","colorMatch":false,"coreOverrides":{}},"shape":"weich","font":"roboto-flex"}'
```

- [ ] **Step 6: E2E – config.json im Stack**

In `tests/e2e/specs/stack-smoke.spec.ts` ergänzen:

```ts
/** Set via SMART_INSTANCE_APPEARANCE in infra/compose/test/compose.test.yaml. */
const STACK_TEST_INSTANCE = {
  colors: { seed: '#6e4c7e', variant: 'tonalSpot', colorMatch: false, coreOverrides: {} },
  shape: 'weich',
  font: 'roboto-flex',
};

test('config.json comes from the container environment and is never cached', async ({
  request,
}) => {
  const response = await request.get('/config.json');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/json');
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(response.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(await response.json()).toEqual({
    features: { instanceAppearanceEditor: true },
    instanceAppearance: STACK_TEST_INSTANCE,
  });
});

test('the instance default from config.json replaces the build default', async ({
  browser,
  page,
}) => {
  const noScript = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await noScript.newPage();
  await staticPage.goto('/');
  const buildDefault = await staticPage.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mat-sys-primary').trim(),
  );
  await noScript.close();

  await page.goto('/');
  // The ThemeService writes its variables inline on <html> once the app runs.
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue('--mat-sys-primary')),
    )
    .not.toBe('');
  const applied = await page.evaluate(() => ({
    primary: getComputedStyle(document.documentElement)
      .getPropertyValue('--mat-sys-primary')
      .trim(),
    corner: getComputedStyle(document.documentElement)
      .getPropertyValue('--mat-sys-corner-medium')
      .trim(),
  }));
  expect(applied.primary).not.toBe(buildDefault);
  expect(applied.corner).toBe('18px');
});
```

Run: `sh infra/compose/test/stack-test.sh`
Expected: PASS einschließlich der beiden neuen Tests (Ecke „mittel“ der Form „weich“ ist 18 px, `packages/theme/src/shape-font.ts`).

- [ ] **Step 7: Doku – Runbook und Spec 4.5**

`docs/runbooks/provisioning.md`, neuer Abschnitt am Ende:

```markdown
## Laufzeitkonfiguration der Web-App

Der `web`-Container schreibt beim Start `/config.json` aus zwei Umgebungsvariablen (`apps/frontend/nginx/40-smart-config.sh`). Änderungen wirken nach einem Neustart des Containers, ohne Neubau.

| Variable                           | Wirkung                                                                                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMART_INSTANCE_APPEARANCE_EDITOR` | `true` zeigt „Einstellungen → Erscheinungsbild der Installation“ (bis Etappe 4 ohne Admin-Rolle). Staging `true`, Produktion nicht setzen.                             |
| `SMART_INSTANCE_APPEARANCE`        | Optional: Standard-Theme der Installation als JSON (`instanceAppearanceSchema` in `packages/contracts`). Ungültiges JSON lässt die App mit dem Build-Standard starten. |

Vorrang des Instanz-Themes: im Browser gespeicherte Instanz (nur solange der Editor aktiv ist) vor `SMART_INSTANCE_APPEARANCE` vor dem Build-Standard.
```

`docs/superpowers/specs/2026-10-11-etappe-3-design-system-design.md`, Abschnitt 4.5, Punkt 4 ersetzen durch:

```markdown
4. **Laufzeitkonfiguration (Self-Hosting):** Der Instanz-Default kann ohne Neubau über `config.json` (vom `web`-Container ausgeliefert, aus den Umgebungsvariablen `SMART_INSTANCE_APPEARANCE_EDITOR` und `SMART_INSTANCE_APPEARANCE` erzeugt) überschrieben werden. Vorrang: im Browser gespeicherte Instanz (nur solange `features.instanceAppearanceEditor` aktiv ist) vor `config.json` vor Build-Default.
```

- [ ] **Step 8: Prüfen und committen**

Run: Prüfung am Ende der Task (Global Constraints), `pnpm --filter @smart/contracts test`, `sh infra/compose/test/stack-test.sh`, `bash infra/deploy/test/run-tests.sh`.

```bash
git add packages/contracts apps/frontend infra/compose tests/e2e docs
git commit -m "feat(frontend): read the runtime configuration from config.json"
```

**Nach dem Merge (Till, auf dem VPS):** in `~/docker/apps/smart-staging/.env` die Zeile `SMART_INSTANCE_APPEARANCE_EDITOR=true` ergänzen; Produktion bleibt ohne. Wirkt mit dem nächsten Deploy.

---

### Task 6: Komponenten aus 3b angleichen

**Files:**

- Create: `apps/frontend/projects/ui/src/lib/option.ts`
- Modify: `apps/frontend/projects/ui/src/lib/segmented-button/segmented-button.ts`, `segmented-button.spec.ts`, `segmented-button.stories.ts`
- Modify: `apps/frontend/projects/ui/src/lib/chip-set/chip-set.ts`, `chip-set.html`, `chip-set.spec.ts`, `chip-set.stories.ts`
- Modify: `apps/frontend/projects/ui/src/lib/color-field/color-field.ts`, `color-field.html`, `color-field.spec.ts`, `color-field.stories.ts`
- Rename: `apps/frontend/projects/ui/src/lib/form-field/error-state-sync.ts` → `field-state-sync.ts`; Modify: `text-field/text-field.ts`, `text-field/text-field.html`
- Modify: `apps/frontend/projects/ui/src/lib/card/card.ts`, `card.html`, `card.stories.ts`
- Modify: `apps/frontend/projects/ui/src/lib/empty-state/empty-state.ts`, `empty-state.html`, `empty-state.scss`, `empty-state.stories.ts`
- Modify: `apps/frontend/projects/ui/src/public-api.ts`

**Interfaces:**

- Produces: `UiOption<T extends string> { value: T; label: string; icon?: IconName }` aus `lib/option.ts` (öffentlich als `type UiOption`); ersetzt `UiSegmentOption` und `UiChipOption` (beide entfallen).
- Produces: `UiChipSet.disabled` und `UiColorField.disabled` (`input(false, { transform: booleanAttribute })`).
- Produces: `UiCard.description` (ersetzt `subheading`), `UiEmptyState.description` (ersetzt `text`). Nebentexte heißen damit überall `description` (Seite, Abschnitt, Karte, Leer-Zustand); nur `ui-list-item` behält `supporting` (M3-Begriff „supporting text“ einer Listenzeile).
- Produces (intern): `UiFieldStateSync`, Selektor `input[matInput][uiFieldStateSync]` (ersetzt `UiErrorStateSync`; die Direktive synchronisiert Fehlerzustand **und** `aria-invalid`).

Die Umbenennungen betreffen nur Stories und Specs als Aufrufer (`git grep -n "subheading\|UiSegmentOption\|UiChipOption\|ErrorStateSync" -- apps` vorher und nachher; nachher keine Treffer außer in `docs/`).

- [ ] **Step 1: Failing tests – `disabled` für Chips und Farbfeld**

In `apps/frontend/projects/ui/src/lib/chip-set/chip-set.spec.ts` ergänzen (der Host bekommt `readonly disabled = signal(false);` und im Template `[disabled]="disabled()"`):

```ts
it('keeps the selection when disabled', () => {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.disabled.set(true);
  fixture.detectChanges();
  expect(options(fixture).every((option) => option.getAttribute('aria-disabled') === 'true')).toBe(
    true,
  );
  options(fixture)[0]!.click();
  fixture.detectChanges();
  expect(fixture.componentInstance.selected()).toEqual(['bath']);
});
```

In `apps/frontend/projects/ui/src/lib/color-field/color-field.spec.ts` ergänzen. Die Host-Komponente der Datei bekommt im Template `[disabled]="disabled()"` und das Feld `readonly disabled = signal(false);`; heißt sie anders als `Host`, den Namen im Test anpassen:

```ts
it('disables the text input and the picker', () => {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.disabled.set(true);
  fixture.detectChanges();
  const inputs = [...fixture.nativeElement.querySelectorAll('input')] as HTMLInputElement[];
  expect(inputs).toHaveLength(2);
  expect(inputs.every((input) => input.disabled)).toBe(true);
});
```

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: FAIL – Template-Fehler „Can't bind to 'disabled'“.

- [ ] **Step 2: `disabled` umsetzen**

`chip-set.ts`: Eingabe `readonly disabled = input(false, { transform: booleanAttribute });` ergänzen; in `chip-set.html` am `mat-chip-listbox` `[disabled]="disabled()"` ergänzen.

`color-field.ts`: dieselbe Eingabe ergänzen (Import `booleanAttribute`); in `color-field.html` an **beiden** `input`-Elementen `[disabled]="disabled()"` ergänzen.

In `chip-set.stories.ts` ergänzen:

```ts
export const Deaktiviert: StoryObj<UiChipSet<string>> = {
  args: { disabled: true, selected: ['bath'] },
  render: (args) => ({
    props: { ...args },
    template: `<ui-chip-set [label]="label" [options]="options" [disabled]="disabled" [(selected)]="selected" />`,
  }),
  play: async ({ canvas }) => {
    for (const option of canvas.getAllByRole('option')) {
      await expect(option).toHaveAttribute('aria-disabled', 'true');
    }
    await userEvent.click(canvas.getByRole('option', { name: 'Küche' }), { pointerEventsCheck: 0 });
    await expect(canvas.getByRole('option', { name: 'Küche' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    await expect(canvas.getByRole('option', { name: 'Bad' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  },
};
```

In `color-field.stories.ts` das gemeinsame `render`-Template um `[disabled]="disabled"` ergänzen und anfügen:

```ts
export const Deaktiviert: StoryObj<UiColorField> = {
  args: { disabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Grundfarbe' })).toBeDisabled();
    await expect(canvas.getByLabelText('Grundfarbe wählen')).toBeDisabled();
  },
};
```

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: PASS.

- [ ] **Step 3: Gemeinsamer Optionstyp**

`apps/frontend/projects/ui/src/lib/option.ts`:

```ts
import type { IconName } from './icon/icon-codepoints';

/** One choice of a selection component (segmented button, chips, select). */
export interface UiOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: IconName;
}
```

In `segmented-button.ts` und `chip-set.ts` das eigene Interface löschen, `import type { UiOption } from '../option';` ergänzen und `input.required<readonly UiOption<T>[]>()` verwenden; den dann unbenutzten Import von `IconName` entfernen. Specs und Stories importieren `type UiOption` aus `'../option'`.

`public-api.ts`: `type UiSegmentOption` und `type UiChipOption` aus den Exporten entfernen, neu `export type { UiOption } from './lib/option';`.

- [ ] **Step 4: Direktive umbenennen**

`git mv apps/frontend/projects/ui/src/lib/form-field/error-state-sync.ts apps/frontend/projects/ui/src/lib/form-field/field-state-sync.ts`; darin Klasse `UiErrorStateSync` → `UiFieldStateSync`, Selektor `input[matInput][uiErrorStateSync]` → `input[matInput][uiFieldStateSync]`, erste Kommentarzeile: `Keeps matInput's error state and aria-invalid in sync with its errorStateMatcher.` (Rest des Kommentars unverändert). In `text-field.ts`, `text-field.html`, `color-field.ts`, `color-field.html` Import und Attribut anpassen.

- [ ] **Step 5: Nebentexte heißen `description`**

`card.ts`: `readonly subheading = input<string>();` → `readonly description = input<string>();`. `card.html`:

<!-- prettier-ignore -->
```html
      @if (description(); as description) {
        <p mat-card-subtitle class="subtitle">{{ description }}</p>
      }
```

`card.stories.ts`: `subheading="Standard"` → `description="Standard"`.

`empty-state.ts`: `readonly text = input<string>();` → `readonly description = input<string>();`. `empty-state.html`:

<!-- prettier-ignore -->
```html
@if (description(); as description) {
  <p class="description">{{ description }}</p>
}
```

`empty-state.scss`: Selektor `.text` → `.description`. `empty-state.stories.ts`: `text="…"` → `description="…"`.

- [ ] **Step 6: Prüfen und committen**

Run: `git grep -n "subheading\|UiSegmentOption\|UiChipOption\|ErrorStateSync" -- apps` → keine Treffer. Dann Prüfung am Ende der Task (Global Constraints) einschließlich der Storybook-Prüfung.

```bash
git add apps/frontend/projects/ui
git commit -m "refactor(ui): share UiOption, name secondary texts description and add disabled states"
```

---

### Task 7: `ui-select` und Story-Helfer für das schmalste Handy

**Files:**

- Create: `apps/frontend/projects/ui/src/lib/select/select.ts`, `select.html`, `select.scss`, `select.spec.ts`, `select.stories.ts`
- Modify: `apps/frontend/projects/ui/src/lib/testing/story-helpers.ts`
- Modify: `apps/frontend/projects/ui/src/public-api.ts`

**Interfaces:**

- Consumes: `UiOption<T>` (Task 6).
- Produces: `UiSelect<T extends string>` (`ui-select`) mit `label = input.required<string>()`, `options = input.required<readonly UiOption<T>[]>()`, `value = model<T>()`, `hint = input<string>()`, `disabled = input(false, booleanAttribute)`. Zeigt nur die Beschriftung; `icon` einer Option wird ignoriert (die Symbolschrift würde sonst als Zeichen im geschlossenen Feld erscheinen).
- Produces (Stories): `withPhoneFrame` (288 px breiter Rahmen mit Klasse `story-narrow`: 320-px-Handy minus 2 × 16 px Seitenrand), `expectNoBrokenWords(root: Element): Promise<void>`.

- [ ] **Step 1: Failing test**

`apps/frontend/projects/ui/src/lib/select/select.spec.ts`:

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import type { UiOption } from '../option';
import { UiSelect } from './select';

type Contrast = 'system' | 'standard' | 'medium' | 'high';

@Component({
  imports: [UiSelect],
  template: `<ui-select
    label="Kontrast"
    hint="Gilt sofort"
    [options]="options"
    [disabled]="disabled()"
    [(value)]="contrast"
  />`,
})
class Host {
  readonly options: readonly UiOption<Contrast>[] = [
    { value: 'system', label: 'System' },
    { value: 'standard', label: 'Standard' },
    { value: 'medium', label: 'Mittel' },
    { value: 'high', label: 'Hoch' },
  ];
  readonly contrast = signal<Contrast>('system');
  readonly disabled = signal(false);
}

function setup() {
  TestBed.configureTestingModule({
    providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const combobox = fixture.nativeElement.querySelector('[role="combobox"]') as HTMLElement;
  return { fixture, combobox };
}

const option = (label: string) =>
  [...document.querySelectorAll('mat-option')].find((element) =>
    element.textContent?.includes(label),
  ) as HTMLElement | undefined;

describe('UiSelect', () => {
  it('labels the field and shows the bound option and the hint', () => {
    const { fixture, combobox } = setup();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('mat-label')?.textContent).toContain('Kontrast');
    expect(combobox.textContent).toContain('System');
    expect(host.querySelector('mat-hint')?.textContent).toContain('Gilt sofort');
  });

  it('writes the chosen option back to the binding', async () => {
    const { fixture, combobox } = setup();
    combobox.click();
    fixture.detectChanges();
    await fixture.whenStable();
    option('Hoch')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.contrast()).toBe('high');
    expect(combobox.textContent).toContain('Hoch');
  });

  it('cannot be opened while disabled', () => {
    const { fixture, combobox } = setup();
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    combobox.click();
    fixture.detectChanges();
    expect(combobox.getAttribute('aria-disabled')).toBe('true');
    expect(option('Hoch')).toBeUndefined();
  });
});
```

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: FAIL – `./select` nicht gefunden.

- [ ] **Step 2: Komponente umsetzen**

`apps/frontend/projects/ui/src/lib/select/select.ts`:

```ts
import { ChangeDetectionStrategy, Component, booleanAttribute, input, model } from '@angular/core';
import { MatOption } from '@angular/material/core';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatSelect, type MatSelectChange } from '@angular/material/select';
import type { UiOption } from '../option';

/**
 * Single choice from a list that opens on demand (M3 outlined select); bind with `[(value)]`.
 * For more or longer options than a segmented button fits on a phone. Option icons are not shown.
 */
@Component({
  selector: 'ui-select',
  imports: [MatFormField, MatLabel, MatHint, MatSelect, MatOption],
  templateUrl: './select.html',
  styleUrl: './select.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiSelect<T extends string> {
  readonly label = input.required<string>();
  readonly options = input.required<readonly UiOption<T>[]>();
  readonly value = model<T>();
  readonly hint = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });

  protected select(change: MatSelectChange): void {
    this.value.set(change.value as T);
  }
}
```

`select.html`:

<!-- prettier-ignore -->
```html
<mat-form-field appearance="outline">
  <mat-label>{{ label() }}</mat-label>
  <mat-select [value]="value()" [disabled]="disabled()" (selectionChange)="select($event)">
    @for (option of options(); track option.value) {
      <mat-option [value]="option.value">{{ option.label }}</mat-option>
    }
  </mat-select>
  @if (hint(); as hint) {
    <mat-hint>{{ hint }}</mat-hint>
  }
</mat-form-field>
```

`select.scss`:

```scss
:host {
  display: block;
  min-width: 0;
}

mat-form-field {
  width: 100%;
}
```

`public-api.ts`: `export { UiSelect } from './lib/select/select';`

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: PASS.

- [ ] **Step 3: Story-Helfer**

In `apps/frontend/projects/ui/src/lib/testing/story-helpers.ts` ergänzen:

```ts
/** 288 px: the content width of a 320 px phone after the page's side padding (2 × 16 px). */
export const withPhoneFrame = componentWrapperDecorator(
  (story) => `<div class="story-narrow" style="width: 288px; max-width: 100%">${story}</div>`,
);

/** Fails when a word is split across lines, i.e. a label broke mid-word instead of at a space. */
export async function expectNoBrokenWords(root: Element): Promise<void> {
  const broken: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const match of (node.textContent ?? '').matchAll(/\S+/g)) {
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      // A word on one line has boxes on one line; a word broken mid-word spans several.
      const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
      if (lines.size > 1) broken.push(match[0]);
    }
  }
  await expect(broken, 'words broken across lines').toEqual([]);
}
```

- [ ] **Step 4: Story**

`apps/frontend/projects/ui/src/lib/select/select.stories.ts`:

```ts
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { expect, fireEvent, screen, userEvent, waitFor, within } from 'storybook/test';
import type { UiOption } from '../option';
import {
  expectNoBrokenWords,
  expectNoHorizontalOverflow,
  withPhoneFrame,
} from '../testing/story-helpers';
import { UiSelect } from './select';

const CONTRAST_OPTIONS: readonly UiOption<string>[] = [
  { value: 'system', label: 'System' },
  { value: 'standard', label: 'Standard' },
  { value: 'medium', label: 'Mittel' },
  { value: 'high', label: 'Hoch' },
];

// The panel is an overlay outside the story root; disabled animations show it at once.
const meta: Meta<UiSelect<string>> = {
  title: 'Bedienung/Auswahlfeld',
  component: UiSelect,
  decorators: [
    applicationConfig({
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    }),
  ],
  args: {
    label: 'Kontrast',
    hint: 'System folgt der Einstellung des Geräts',
    value: 'system',
    options: CONTRAST_OPTIONS,
  },
};
export default meta;

const template = `<ui-select [label]="label" [hint]="hint" [options]="options" [disabled]="disabled" [(value)]="value" />`;

export const Standard: StoryObj<UiSelect<string>> = {
  render: (args) => ({ props: { ...args }, template }),
  play: async ({ canvas }) => {
    const combobox = canvas.getByRole('combobox', { name: 'Kontrast' });
    await expect(combobox.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
    await userEvent.tab();
    await expect(combobox).toHaveFocus();
    // Material reads keyCode (Enter 13, arrow down 40), which user-event does not send.
    await fireEvent.keyDown(combobox, { key: 'Enter', code: 'Enter', keyCode: 13 });
    const listbox = await screen.findByRole('listbox', { name: 'Kontrast' });
    for (const option of within(listbox).getAllByRole('option')) {
      await expect(option.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
    }
    await fireEvent.keyDown(combobox, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 });
    await fireEvent.keyDown(combobox, { key: 'Enter', code: 'Enter', keyCode: 13 });
    await waitFor(() => expect(combobox).toHaveTextContent('Standard'));
    await userEvent.click(combobox);
    await userEvent.click(await screen.findByRole('option', { name: 'Hoch' }));
    await waitFor(() => expect(combobox).toHaveTextContent('Hoch'));
  },
};

export const Deaktiviert: StoryObj<UiSelect<string>> = {
  args: { disabled: true },
  render: (args) => ({ props: { ...args }, template }),
  play: async ({ canvas }) => {
    const combobox = canvas.getByRole('combobox', { name: 'Kontrast' });
    await expect(combobox).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(combobox, { pointerEventsCheck: 0 });
    await expect(screen.queryByRole('listbox')).toBeNull();
  },
};

export const Schmal: StoryObj<UiSelect<string>> = {
  decorators: [withPhoneFrame],
  args: {
    label: 'Schrift der Installation',
    value: 'atkinson',
    options: [
      { value: 'roboto-flex', label: 'Roboto Flex' },
      { value: 'figtree', label: 'Figtree' },
      { value: 'atkinson', label: 'Atkinson Hyperlegible Next' },
    ],
    hint: 'Gilt für alle Nutzerinnen und Nutzer dieser Installation',
  },
  render: (args) => ({ props: { ...args }, template }),
  play: async ({ canvasElement }) => {
    const frame = canvasElement.querySelector('.story-narrow')!;
    await expectNoHorizontalOverflow(frame);
    await expectNoBrokenWords(frame);
  },
};
```

Run: `pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci`
Expected: PASS (beide Durchläufe). Scheitert `Schmal` an `expectNoBrokenWords` im Hinweistext, ist das ein echter Befund: Der Hinweis braucht `overflow-wrap: normal` (Übertrag 3b „Umbruch“) – dann in `select.scss` `mat-form-field { overflow-wrap: normal; }` ergänzen und als Ruling festhalten.

- [ ] **Step 5: Prüfen und committen**

Run: Prüfung am Ende der Task (Global Constraints) einschließlich der Storybook-Prüfung.

```bash
git add apps/frontend/projects/ui
git commit -m "feat(ui): add ui-select and story helpers for the narrowest phone"
```

---

### Task 8: Theme-Editor, Teil 1 – Farben (`ui-theme-colors`)

**Files:**

- Modify: `apps/frontend/package.json` (Dev-Abhängigkeit `@jsverse/transloco-keys-manager`)
- Create: `apps/frontend/projects/ui/src/lib/theme-editor/theme-editor-labels.ts`
- Create: `apps/frontend/projects/ui/src/lib/theme-editor/translated-options.ts`
- Create: `apps/frontend/projects/ui/src/lib/theme-editor/theme-colors.ts`, `theme-colors.html`, `theme-colors.scss`, `theme-colors.spec.ts`
- Modify: `apps/frontend/projects/ui/src/i18n/de.json`, `apps/frontend/projects/ui/src/i18n/en.json`

**Interfaces:**

- Consumes: `deriveKeyColors(colors: ThemeColors): Record<CoreColorId, { hex: string; source: 'derived' | 'override' }>` aus `@smart/theme`; `UiColorField`, `UiSelect`, `UiSwitch`, `UiSection`, `UiStack` (3b/Task 6/7); `provideUiTranslocoTesting` (Task 2).
- Produces (intern, nicht öffentlich): `UiThemeColors` (`ui-theme-colors`) mit `colors = model.required<ThemeColors>()`.
- Produces (intern): `SEED_SUGGESTIONS: readonly { hex: string; labelKey: string }[]`, `VARIANT_KEYS: Record<ThemeVariant, string>`, `CORE_COLOR_KEYS: Record<CoreColorId, string>` in `theme-editor-labels.ts`; `translatedOptions<T extends string>(values: readonly T[], keys: Record<T, string>): Signal<UiOption<T>[]>` in `translated-options.ts` (nur im Injection Context aufrufen).

Verhalten (Spec 4.4): Nicht überschriebene Kernfarben zeigen „Abgeleitet: #…“ und folgen der Grundfarbe. „Anpassen“ startet ein Override beim aktuell abgeleiteten Wert; Ausschalten entfernt es. Mit Farbtreue bleibt die Variante wählbar, ein Hinweis erklärt, dass sie dann nur die abgeleiteten Farben bestimmt (die Primärrollen folgen der Fidelity-Logik, Übertrag 3a). Die Vorschläge sind runde Farbflächen (48 px); die gewählte trägt `aria-pressed="true"` und einen Ring in `--mat-sys-on-surface` (Form statt nur Farbe, WCAG 1.4.1).

- [ ] **Step 1: Übersetzungen der Farbtexte**

`apps/frontend/package.json`, `devDependencies`: `"@jsverse/transloco-keys-manager": "8.1.1"`; `pnpm install`.

`apps/frontend/projects/ui/src/i18n/de.json`:

```json
{
  "ui": {
    "themeEditor": {
      "seed": "Grundfarbe",
      "seedPicker": "Grundfarbe auswählen",
      "invalidColor": "Bitte eine Farbe im Format #rrggbb eingeben.",
      "suggestionsLabel": "Vorschläge für die Grundfarbe",
      "suggestions": {
        "petrol": "Petrol",
        "moss": "Moos",
        "slate": "Schieferblau",
        "amber": "Bernstein",
        "plum": "Pflaume",
        "graphite": "Graphit"
      },
      "variant": "Variante",
      "variants": {
        "tonalSpot": "Tonal Spot (Standard)",
        "neutral": "Neutral",
        "vibrant": "Vibrant",
        "expressive": "Expressive",
        "fidelity": "Fidelity",
        "content": "Content",
        "monochrome": "Monochrome"
      },
      "variantWithColorMatch": "Mit Farbtreue legt die Variante nur die abgeleiteten Farben fest.",
      "colorMatch": "Farbtreue",
      "coreColors": "Kernfarben",
      "coreColorsDescription": "Nicht angepasste Kernfarben leiten sich aus der Grundfarbe ab.",
      "coreColor": {
        "primary": "Primär",
        "secondary": "Sekundär",
        "tertiary": "Tertiär",
        "error": "Fehler",
        "neutral": "Neutral",
        "neutralVariant": "Neutral (Variante)"
      },
      "customize": "{{color}} anpassen",
      "pickColor": "{{color}} auswählen",
      "derived": "Abgeleitet: {{hex}}"
    }
  }
}
```

`apps/frontend/projects/ui/src/i18n/en.json`:

```json
{
  "ui": {
    "themeEditor": {
      "seed": "Seed color",
      "seedPicker": "Choose seed color",
      "invalidColor": "Enter a color as #rrggbb.",
      "suggestionsLabel": "Seed color suggestions",
      "suggestions": {
        "petrol": "Petrol",
        "moss": "Moss",
        "slate": "Slate blue",
        "amber": "Amber",
        "plum": "Plum",
        "graphite": "Graphite"
      },
      "variant": "Variant",
      "variants": {
        "tonalSpot": "Tonal spot (default)",
        "neutral": "Neutral",
        "vibrant": "Vibrant",
        "expressive": "Expressive",
        "fidelity": "Fidelity",
        "content": "Content",
        "monochrome": "Monochrome"
      },
      "variantWithColorMatch": "With color match, the variant only sets the derived colors.",
      "colorMatch": "Color match",
      "coreColors": "Key colors",
      "coreColorsDescription": "Key colors you do not customize are derived from the seed color.",
      "coreColor": {
        "primary": "Primary",
        "secondary": "Secondary",
        "tertiary": "Tertiary",
        "error": "Error",
        "neutral": "Neutral",
        "neutralVariant": "Neutral variant"
      },
      "customize": "Customize {{color}}",
      "pickColor": "Choose {{color}}",
      "derived": "Derived: {{hex}}"
    }
  }
}
```

- [ ] **Step 2: Failing test**

`apps/frontend/projects/ui/src/lib/theme-editor/theme-colors.spec.ts`:

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { DEFAULT_INSTANCE_APPEARANCE, type Language, type ThemeColors } from '@smart/contracts';
import { deriveKeyColors } from '@smart/theme';
import { provideUiTranslocoTesting } from '../testing/i18n-testing';
import { UiThemeColors } from './theme-colors';

@Component({
  imports: [UiThemeColors],
  template: `<ui-theme-colors [(colors)]="colors" />`,
})
class Host {
  readonly colors = signal<ThemeColors>(DEFAULT_INSTANCE_APPEARANCE.colors);
}

async function setup(language: Language = 'de') {
  TestBed.configureTestingModule({
    providers: [
      provideUiTranslocoTesting(language),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  const refresh = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { fixture, host: fixture.componentInstance, element, refresh };
}

const swatch = (element: HTMLElement, name: string) =>
  element.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement;
const toggle = (element: HTMLElement, label: string) =>
  [...element.querySelectorAll('mat-slide-toggle')]
    .find((candidate) => candidate.textContent?.includes(label))!
    .querySelector('button') as HTMLButtonElement;

describe('UiThemeColors', () => {
  it('marks the suggestion matching the seed and applies a chosen one', async () => {
    const { host, element, refresh } = await setup();
    expect(swatch(element, 'Petrol').getAttribute('aria-pressed')).toBe('true');
    swatch(element, 'Pflaume').click();
    await refresh();
    expect(host.colors().seed).toBe('#6e4c7e');
    expect(swatch(element, 'Pflaume').getAttribute('aria-pressed')).toBe('true');
    expect(swatch(element, 'Petrol').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows derived key colors that follow the seed', async () => {
    const { host, element, refresh } = await setup();
    const derived = () => deriveKeyColors(host.colors()).secondary.hex;
    expect(element.textContent).toContain(`Abgeleitet: ${derived()}`);
    swatch(element, 'Bernstein').click();
    await refresh();
    expect(element.textContent).toContain(`Abgeleitet: ${derived()}`);
  });

  it('starts an override at the derived value and removes it again', async () => {
    const { host, element, refresh } = await setup();
    const derived = deriveKeyColors(host.colors()).tertiary.hex;
    toggle(element, 'Tertiär anpassen').click();
    await refresh();
    expect(host.colors().coreOverrides.tertiary).toBe(derived);
    expect(
      [...element.querySelectorAll('mat-label')].map((label) => label.textContent?.trim()),
    ).toContain('Tertiär');
    expect(element.textContent).not.toContain(`Abgeleitet: ${derived}`);
    toggle(element, 'Tertiär anpassen').click();
    await refresh();
    expect(host.colors().coreOverrides.tertiary).toBeUndefined();
  });

  it('ignores an invalid color while typing', async () => {
    const { host, element, refresh } = await setup();
    const seedInput = element.querySelector('input[type="text"]') as HTMLInputElement;
    seedInput.value = '#zz';
    seedInput.dispatchEvent(new Event('input'));
    await refresh();
    expect(host.colors().seed).toBe(DEFAULT_INSTANCE_APPEARANCE.colors.seed);
  });

  it('explains the variant while color match is on', async () => {
    const { host, element, refresh } = await setup();
    expect(element.textContent).not.toContain('nur die abgeleiteten Farben');
    toggle(element, 'Farbtreue').click();
    await refresh();
    expect(host.colors().colorMatch).toBe(true);
    expect(element.textContent).toContain('nur die abgeleiteten Farben');
  });

  it('keeps working with a gray override', async () => {
    const { host, element, refresh } = await setup();
    host.colors.set({ ...host.colors(), coreOverrides: { neutral: '#808080' } });
    await refresh();
    expect(toggle(element, 'Neutral anpassen').getAttribute('aria-checked')).toBe('true');
  });

  it('speaks English', async () => {
    const { element } = await setup('en');
    expect(element.textContent).toContain('Seed color');
    expect(toggle(element, 'Customize Tertiary')).toBeTruthy();
  });
});
```

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: FAIL – `./theme-colors` nicht gefunden.

- [ ] **Step 3: Beschriftungen und Optionen**

`apps/frontend/projects/ui/src/lib/theme-editor/theme-editor-labels.ts`:

```ts
import { marker } from '@jsverse/transloco-keys-manager/marker';
import type { CoreColorId, ThemeVariant } from '@smart/contracts';

// These keys are picked at runtime; marker() makes them visible to `pnpm i18n:check`.

export interface SeedSuggestion {
  readonly hex: string;
  readonly labelKey: string;
}

/** Same palette as the Storybook toolbar. */
export const SEED_SUGGESTIONS: readonly SeedSuggestion[] = [
  { hex: '#00687a', labelKey: marker('ui.themeEditor.suggestions.petrol') },
  { hex: '#4c6b3d', labelKey: marker('ui.themeEditor.suggestions.moss') },
  { hex: '#3e5f90', labelKey: marker('ui.themeEditor.suggestions.slate') },
  { hex: '#8a5a00', labelKey: marker('ui.themeEditor.suggestions.amber') },
  { hex: '#6e4c7e', labelKey: marker('ui.themeEditor.suggestions.plum') },
  { hex: '#5d5f63', labelKey: marker('ui.themeEditor.suggestions.graphite') },
];

export const VARIANT_KEYS: Record<ThemeVariant, string> = {
  tonalSpot: marker('ui.themeEditor.variants.tonalSpot'),
  neutral: marker('ui.themeEditor.variants.neutral'),
  vibrant: marker('ui.themeEditor.variants.vibrant'),
  expressive: marker('ui.themeEditor.variants.expressive'),
  fidelity: marker('ui.themeEditor.variants.fidelity'),
  content: marker('ui.themeEditor.variants.content'),
  monochrome: marker('ui.themeEditor.variants.monochrome'),
};

export const CORE_COLOR_KEYS: Record<CoreColorId, string> = {
  primary: marker('ui.themeEditor.coreColor.primary'),
  secondary: marker('ui.themeEditor.coreColor.secondary'),
  tertiary: marker('ui.themeEditor.coreColor.tertiary'),
  error: marker('ui.themeEditor.coreColor.error'),
  neutral: marker('ui.themeEditor.coreColor.neutral'),
  neutralVariant: marker('ui.themeEditor.coreColor.neutralVariant'),
};

export const VARIANT_WITH_COLOR_MATCH_KEY = marker('ui.themeEditor.variantWithColorMatch');
```

`apps/frontend/projects/ui/src/lib/theme-editor/translated-options.ts`:

```ts
import { computed, type Signal } from '@angular/core';
import { translateSignal } from '@jsverse/transloco';
import type { UiOption } from '../option';

/** Options whose labels follow the active language. Call in an injection context (field initializer). */
export function translatedOptions<T extends string>(
  values: readonly T[],
  keys: Record<T, string>,
): Signal<UiOption<T>[]> {
  const labels = translateSignal(values.map((value) => keys[value]));
  return computed(() => values.map((value, index) => ({ value, label: labels()[index] ?? value })));
}
```

- [ ] **Step 4: Komponente umsetzen**

`apps/frontend/projects/ui/src/lib/theme-editor/theme-colors.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, model } from '@angular/core';
import { TranslocoPipe, translateSignal } from '@jsverse/transloco';
import {
  CORE_COLOR_IDS,
  THEME_VARIANTS,
  type CoreColorId,
  type ThemeColors,
  type ThemeVariant,
} from '@smart/contracts';
import { deriveKeyColors } from '@smart/theme';
import { UiColorField } from '../color-field/color-field';
import { UiSection } from '../layout/section/section';
import { UiStack } from '../layout/stack/stack';
import { UiSelect } from '../select/select';
import { UiSwitch } from '../switch/switch';
import {
  CORE_COLOR_KEYS,
  SEED_SUGGESTIONS,
  VARIANT_KEYS,
  VARIANT_WITH_COLOR_MATCH_KEY,
} from './theme-editor-labels';
import { translatedOptions } from './translated-options';

type Overrides = ThemeColors['coreOverrides'];

const without = (overrides: Overrides, id: CoreColorId): Overrides =>
  Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== id)) as Overrides;

/** Color part of the theme editor (spec 4.4): seed, variant, color match and key color overrides. */
@Component({
  selector: 'ui-theme-colors',
  imports: [TranslocoPipe, UiColorField, UiSection, UiSelect, UiStack, UiSwitch],
  templateUrl: './theme-colors.html',
  styleUrl: './theme-colors.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiThemeColors {
  readonly colors = model.required<ThemeColors>();

  protected readonly suggestions = SEED_SUGGESTIONS;
  protected readonly suggestionLabels = translateSignal(
    SEED_SUGGESTIONS.map((suggestion) => suggestion.labelKey),
  );
  protected readonly variantOptions = translatedOptions(THEME_VARIANTS, VARIANT_KEYS);
  private readonly colorMatchHint = translateSignal(VARIANT_WITH_COLOR_MATCH_KEY);
  protected readonly variantHint = computed(() =>
    this.colors().colorMatch ? this.colorMatchHint() : undefined,
  );
  protected readonly coreColorIds = CORE_COLOR_IDS;
  protected readonly coreColorNames = translateSignal(
    CORE_COLOR_IDS.map((id) => CORE_COLOR_KEYS[id]),
  );
  /** Overrides show their own value; all others are derived from the current source (spec 4.4). */
  protected readonly keyColors = computed(() => deriveKeyColors(this.colors()));

  protected setSeed(seed: string): void {
    this.colors.update((colors) => ({ ...colors, seed }));
  }

  protected setVariant(variant: ThemeVariant | undefined): void {
    if (variant) this.colors.update((colors) => ({ ...colors, variant }));
  }

  protected setColorMatch(colorMatch: boolean): void {
    this.colors.update((colors) => ({ ...colors, colorMatch }));
  }

  /** An override starts at the currently derived value, so switching it on changes nothing yet. */
  protected setOverridden(id: CoreColorId, overridden: boolean): void {
    const derived = this.keyColors()[id].hex;
    this.colors.update((colors) => ({
      ...colors,
      coreOverrides: overridden
        ? { ...colors.coreOverrides, [id]: derived }
        : without(colors.coreOverrides, id),
    }));
  }

  protected setOverride(id: CoreColorId, hex: string): void {
    this.colors.update((colors) => ({
      ...colors,
      coreOverrides: { ...colors.coreOverrides, [id]: hex },
    }));
  }
}
```

`theme-colors.html`:

<!-- prettier-ignore -->
```html
<ui-stack gap="lg">
  <ui-stack gap="sm">
    <ui-color-field
      [label]="'ui.themeEditor.seed' | transloco"
      [pickerLabel]="'ui.themeEditor.seedPicker' | transloco"
      [invalidMessage]="'ui.themeEditor.invalidColor' | transloco"
      [value]="colors().seed"
      (valueChange)="setSeed($event)"
    />
    <div
      class="suggestions"
      role="group"
      [attr.aria-label]="'ui.themeEditor.suggestionsLabel' | transloco"
    >
      @for (suggestion of suggestions; track suggestion.hex; let index = $index) {
        <button
          type="button"
          class="swatch"
          [style.background-color]="suggestion.hex"
          [attr.aria-label]="suggestionLabels()[index]"
          [attr.aria-pressed]="colors().seed === suggestion.hex"
          (click)="setSeed(suggestion.hex)"
        ></button>
      }
    </div>
  </ui-stack>
  <ui-select
    [label]="'ui.themeEditor.variant' | transloco"
    [options]="variantOptions()"
    [value]="colors().variant"
    [hint]="variantHint()"
    (valueChange)="setVariant($event)"
  />
  <ui-switch
    [label]="'ui.themeEditor.colorMatch' | transloco"
    [checked]="colors().colorMatch"
    (checkedChange)="setColorMatch($event)"
  />
  <ui-section
    [heading]="'ui.themeEditor.coreColors' | transloco"
    [description]="'ui.themeEditor.coreColorsDescription' | transloco"
    [level]="3"
  >
    <ui-stack gap="md">
      @for (id of coreColorIds; track id; let index = $index) {
        @let color = keyColors()[id];
        @let name = coreColorNames()[index] ?? id;
        <ui-stack gap="xs">
          <ui-switch
            [label]="'ui.themeEditor.customize' | transloco: { color: name }"
            [checked]="color.source === 'override'"
            (checkedChange)="setOverridden(id, $event)"
          />
          @if (color.source === 'override') {
            <ui-color-field
              [label]="name"
              [pickerLabel]="'ui.themeEditor.pickColor' | transloco: { color: name }"
              [invalidMessage]="'ui.themeEditor.invalidColor' | transloco"
              [value]="color.hex"
              (valueChange)="setOverride(id, $event)"
            />
          } @else {
            <p class="derived">
              <span class="dot" aria-hidden="true" [style.background-color]="color.hex"></span>
              {{ 'ui.themeEditor.derived' | transloco: { hex: color.hex } }}
            </p>
          }
        </ui-stack>
      }
    </ui-stack>
  </ui-section>
</ui-stack>
```

`theme-colors.scss`:

```scss
:host {
  display: block;
  min-width: 0;
}

.suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--smart-space-sm);
}

.swatch {
  inline-size: var(--smart-size-touch);
  block-size: var(--smart-size-touch);
  padding: 0;
  border: var(--smart-border-width) solid var(--mat-sys-outline);
  border-radius: var(--mat-sys-corner-full);
  cursor: pointer;

  &[aria-pressed='true'] {
    box-shadow:
      0 0 0 var(--smart-space-xs) var(--mat-sys-surface),
      0 0 0 calc(var(--smart-space-xs) + var(--smart-focus-width)) var(--mat-sys-on-surface);
  }

  &:focus-visible {
    outline: var(--smart-focus-width) solid var(--mat-sys-secondary);
    outline-offset: calc(var(--smart-space-xs) + var(--smart-focus-width));
  }
}

.derived {
  display: flex;
  align-items: center;
  gap: var(--smart-space-sm);
  margin: 0;
  color: var(--mat-sys-on-surface-variant);
  font: var(--mat-sys-body-medium);
}

.dot {
  flex: none;
  inline-size: var(--smart-size-icon-sm);
  block-size: var(--smart-size-icon-sm);
  border: var(--smart-border-width) solid var(--mat-sys-outline);
  border-radius: var(--mat-sys-corner-full);
}
```

Prüfen, dass `--smart-space-xs` und `--smart-border-width` in `lib/tokens/layout.css` existieren; fehlt eins, den nächstliegenden vorhandenen Token nehmen und als Ruling festhalten (keine neuen festen Werte außerhalb `tokens/`).

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false && pnpm i18n:check`
Expected: PASS; `i18n:check` zweimal `ok` (alle neuen Schlüssel sind benutzt: Template-Schlüssel direkt, die übrigen über `marker`).

- [ ] **Step 5: Prüfen und committen**

Run: Prüfung am Ende der Task (Global Constraints).

```bash
git add apps/frontend pnpm-lock.yaml
git commit -m "feat(ui): add the color part of the theme editor"
```

---

### Task 9: Theme-Editor, Teil 2 – `ui-theme-editor` (persönlich und Installation)

**Files:**

- Create: `apps/frontend/projects/ui/src/lib/theme-editor/theme-editor.ts`, `theme-editor.html`, `theme-editor.scss`, `theme-editor.spec.ts`, `theme-editor.stories.ts`
- Create: `apps/frontend/projects/ui/src/lib/theme-editor/theme-editor-live.story-component.ts`
- Modify: `apps/frontend/projects/ui/src/lib/theme-editor/theme-editor-labels.ts`
- Modify: `apps/frontend/projects/ui/src/i18n/de.json`, `apps/frontend/projects/ui/src/i18n/en.json`
- Modify: `apps/frontend/projects/ui/src/public-api.ts`

**Interfaces:**

- Consumes: `UiThemeColors`, `translatedOptions`, Label-Maps (Task 8); `UiSegmentedButton`, `UiSelect`, `UiSwitch`, `UiButton`, `UiSection`, `UiStack`; `ThemeService` (nur Live-Story).
- Produces (`@smart/ui`): `UiThemeEditor` (`ui-theme-editor`), `type UiThemeEditorMode = 'personal' | 'instance'`:
  - `mode = input.required<UiThemeEditorMode>()`
  - `instance = model.required<InstanceAppearance>()` – im Modus `instance` bearbeitet (Farben, Formen, Schrift); im Modus `personal` nur gelesen (Startwert für „Eigene Farben“).
  - `personal = model<PersonalAppearance>(DEFAULT_PERSONAL_APPEARANCE)` – nur im Modus `personal` (Modus, Kontrast, eigene Farben).
  - `reset = output<void>()` – „Auf Standard zurücksetzen“; die Seite (3d) ruft `ThemeService.resetPersonal()` bzw. `resetInstance()`.
- 3d bindet: `<ui-theme-editor mode="personal" [instance]="theme.instance()" [personal]="theme.personal()" (personalChange)="theme.setPersonal($event)" (reset)="theme.resetPersonal()" />` (Muster in der Live-Story).

- [ ] **Step 1: Übersetzungen ergänzen**

In `apps/frontend/projects/ui/src/i18n/de.json` unter `ui.themeEditor` ergänzen:

```json
      "display": "Darstellung",
      "mode": "Modus",
      "modes": { "system": "System", "light": "Hell", "dark": "Dunkel" },
      "contrast": "Kontrast",
      "contrasts": { "system": "System", "standard": "Standard", "medium": "Mittel", "high": "Hoch" },
      "contrastSystemHint": "Standard, oder Hoch, wenn das Gerät mehr Kontrast verlangt.",
      "colors": "Farben",
      "ownColors": "Eigene Farben",
      "installationColors": "Es gelten die Farben der Installation.",
      "shapeAndFont": "Formen und Schrift",
      "shape": "Formen",
      "shapes": { "kantig": "Kantig", "standard": "Standard", "weich": "Weich" },
      "font": "Schrift",
      "fonts": {
        "roboto-flex": "Roboto Flex",
        "figtree": "Figtree",
        "atkinson": "Atkinson Hyperlegible Next"
      },
      "reset": "Auf Standard zurücksetzen"
```

In `en.json` entsprechend:

```json
      "display": "Display",
      "mode": "Mode",
      "modes": { "system": "System", "light": "Light", "dark": "Dark" },
      "contrast": "Contrast",
      "contrasts": { "system": "System", "standard": "Standard", "medium": "Medium", "high": "High" },
      "contrastSystemHint": "Standard, or high when the device asks for more contrast.",
      "colors": "Colors",
      "ownColors": "My own colors",
      "installationColors": "The installation's colors apply.",
      "shapeAndFont": "Shapes and font",
      "shape": "Shapes",
      "shapes": { "kantig": "Sharp", "standard": "Standard", "weich": "Soft" },
      "font": "Font",
      "fonts": {
        "roboto-flex": "Roboto Flex",
        "figtree": "Figtree",
        "atkinson": "Atkinson Hyperlegible Next"
      },
      "reset": "Reset to default"
```

In `theme-editor-labels.ts` ergänzen (Importe `ThemeContrast`, `ThemeFont`, `ThemeMode`, `ThemeShape` aufnehmen):

```ts
export const MODE_KEYS: Record<ThemeMode, string> = {
  system: marker('ui.themeEditor.modes.system'),
  light: marker('ui.themeEditor.modes.light'),
  dark: marker('ui.themeEditor.modes.dark'),
};

export const CONTRAST_KEYS: Record<ThemeContrast, string> = {
  system: marker('ui.themeEditor.contrasts.system'),
  standard: marker('ui.themeEditor.contrasts.standard'),
  medium: marker('ui.themeEditor.contrasts.medium'),
  high: marker('ui.themeEditor.contrasts.high'),
};

export const SHAPE_KEYS: Record<ThemeShape, string> = {
  kantig: marker('ui.themeEditor.shapes.kantig'),
  standard: marker('ui.themeEditor.shapes.standard'),
  weich: marker('ui.themeEditor.shapes.weich'),
};

export const FONT_KEYS: Record<ThemeFont, string> = {
  'roboto-flex': marker('ui.themeEditor.fonts.roboto-flex'),
  figtree: marker('ui.themeEditor.fonts.figtree'),
  atkinson: marker('ui.themeEditor.fonts.atkinson'),
};

export const CONTRAST_SYSTEM_HINT_KEY = marker('ui.themeEditor.contrastSystemHint');
```

- [ ] **Step 2: Failing test**

`apps/frontend/projects/ui/src/lib/theme-editor/theme-editor.spec.ts`:

```ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import {
  DEFAULT_INSTANCE_APPEARANCE,
  DEFAULT_PERSONAL_APPEARANCE,
  type InstanceAppearance,
  type Language,
  type PersonalAppearance,
} from '@smart/contracts';
import { provideUiTranslocoTesting } from '../testing/i18n-testing';
import { UiThemeEditor, type UiThemeEditorMode } from './theme-editor';

@Component({
  imports: [UiThemeEditor],
  template: `<ui-theme-editor
    [mode]="mode()"
    [(instance)]="instance"
    [(personal)]="personal"
    (reset)="resets.set(resets() + 1)"
  />`,
})
class Host {
  readonly mode = signal<UiThemeEditorMode>('personal');
  readonly instance = signal<InstanceAppearance>(DEFAULT_INSTANCE_APPEARANCE);
  readonly personal = signal<PersonalAppearance>(DEFAULT_PERSONAL_APPEARANCE);
  readonly resets = signal(0);
}

async function setup(mode: UiThemeEditorMode, language: Language = 'de') {
  TestBed.configureTestingModule({
    providers: [
      provideUiTranslocoTesting(language),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.mode.set(mode);
  const refresh = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  await refresh();
  const element = fixture.nativeElement as HTMLElement;
  /** Opens the select labelled `label` and picks the option `option`. */
  const choose = async (label: string, option: string) => {
    const field = [...element.querySelectorAll('ui-select')].find((candidate) =>
      candidate.querySelector('mat-label')?.textContent?.includes(label),
    )!;
    (field.querySelector('[role="combobox"]') as HTMLElement).click();
    await refresh();
    (
      [...document.querySelectorAll('mat-option')].find((candidate) =>
        candidate.textContent?.includes(option),
      ) as HTMLElement
    ).click();
    await refresh();
  };
  const toggle = (label: string) =>
    [...element.querySelectorAll('mat-slide-toggle')]
      .find((candidate) => candidate.textContent?.includes(label))!
      .querySelector('button') as HTMLButtonElement;
  const radio = (label: string) =>
    [...element.querySelectorAll('mat-button-toggle button')].find((candidate) =>
      candidate.textContent?.includes(label),
    ) as HTMLButtonElement;
  const labels = () =>
    [...element.querySelectorAll('mat-label')].map((label) => label.textContent?.trim());
  return { host: fixture.componentInstance, element, refresh, choose, toggle, radio, labels };
}

describe('UiThemeEditor in personal mode', () => {
  it('offers mode, contrast and own colors, but not shape and font', async () => {
    const { element, labels } = await setup('personal');
    expect(element.querySelector('mat-button-toggle-group')?.getAttribute('aria-label')).toBe(
      'Modus',
    );
    expect(labels()).toContain('Kontrast');
    expect(labels()).not.toContain('Formen');
    expect(labels()).not.toContain('Schrift');
    expect(element.textContent).toContain('Es gelten die Farben der Installation.');
  });

  it('writes mode and contrast to the personal appearance', async () => {
    const { host, refresh, choose, radio, element } = await setup('personal');
    expect(element.textContent).toContain('wenn das Gerät mehr Kontrast verlangt');
    radio('Dunkel').click();
    await refresh();
    await choose('Kontrast', 'Hoch');
    expect(host.personal()).toEqual({ mode: 'dark', contrast: 'high' });
    expect(element.textContent).not.toContain('wenn das Gerät mehr Kontrast verlangt');
  });

  it('starts own colors from the installation colors and drops them again', async () => {
    const { host, refresh, toggle, element } = await setup('personal');
    toggle('Eigene Farben').click();
    await refresh();
    expect(host.personal().colors).toEqual(DEFAULT_INSTANCE_APPEARANCE.colors);
    expect(element.querySelector('ui-theme-colors')).not.toBeNull();
    toggle('Eigene Farben').click();
    await refresh();
    expect(host.personal().colors).toBeUndefined();
    expect(host.instance()).toEqual(DEFAULT_INSTANCE_APPEARANCE);
  });

  it('asks the host to reset', async () => {
    const { host, element, refresh } = await setup('personal');
    const reset = [...element.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Auf Standard zurücksetzen'),
    )!;
    reset.click();
    await refresh();
    expect(host.resets()).toBe(1);
  });

  it('speaks English', async () => {
    const { element, labels } = await setup('personal', 'en');
    expect(element.querySelector('mat-button-toggle-group')?.getAttribute('aria-label')).toBe(
      'Mode',
    );
    expect(labels()).toContain('Contrast');
  });
});

describe('UiThemeEditor in instance mode', () => {
  it('edits colors, shape and font of the installation, but no personal settings', async () => {
    const { host, element, choose, refresh } = await setup('instance');
    expect(element.querySelector('mat-button-toggle-group')).toBeNull();
    await choose('Formen', 'Weich');
    await choose('Schrift', 'Figtree');
    (element.querySelector('button[aria-label="Pflaume"]') as HTMLButtonElement).click();
    await refresh();
    expect(host.instance()).toEqual({
      ...DEFAULT_INSTANCE_APPEARANCE,
      colors: { ...DEFAULT_INSTANCE_APPEARANCE.colors, seed: '#6e4c7e' },
      shape: 'weich',
      font: 'figtree',
    });
    expect(host.personal()).toEqual(DEFAULT_PERSONAL_APPEARANCE);
  });
});
```

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false`
Expected: FAIL – `./theme-editor` nicht gefunden.

- [ ] **Step 3: Komponente umsetzen**

`apps/frontend/projects/ui/src/lib/theme-editor/theme-editor.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { TranslocoPipe, translateSignal } from '@jsverse/transloco';
import {
  DEFAULT_PERSONAL_APPEARANCE,
  THEME_CONTRASTS,
  THEME_FONTS,
  THEME_MODES,
  THEME_SHAPES,
  type InstanceAppearance,
  type PersonalAppearance,
  type ThemeColors,
  type ThemeContrast,
  type ThemeFont,
  type ThemeMode,
  type ThemeShape,
} from '@smart/contracts';
import { UiButton } from '../button/button';
import { UiSection } from '../layout/section/section';
import { UiStack } from '../layout/stack/stack';
import { UiSegmentedButton } from '../segmented-button/segmented-button';
import { UiSelect } from '../select/select';
import { UiSwitch } from '../switch/switch';
import { UiThemeColors } from './theme-colors';
import {
  CONTRAST_KEYS,
  CONTRAST_SYSTEM_HINT_KEY,
  FONT_KEYS,
  MODE_KEYS,
  SHAPE_KEYS,
} from './theme-editor-labels';
import { translatedOptions } from './translated-options';

export type UiThemeEditorMode = 'personal' | 'instance';

/**
 * Theme editor (spec 2, 4.2): `personal` edits mode, contrast and optional own colors;
 * `instance` edits the installation's colors, shapes and font. Changes are written to the models
 * at once; the host applies and stores them (live) and handles `reset`.
 */
@Component({
  selector: 'ui-theme-editor',
  imports: [
    TranslocoPipe,
    UiButton,
    UiSection,
    UiSegmentedButton,
    UiSelect,
    UiStack,
    UiSwitch,
    UiThemeColors,
  ],
  templateUrl: './theme-editor.html',
  styleUrl: './theme-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiThemeEditor {
  readonly mode = input.required<UiThemeEditorMode>();
  readonly instance = model.required<InstanceAppearance>();
  readonly personal = model<PersonalAppearance>(DEFAULT_PERSONAL_APPEARANCE);
  readonly reset = output<void>();

  protected readonly modeOptions = translatedOptions(THEME_MODES, MODE_KEYS);
  protected readonly contrastOptions = translatedOptions(THEME_CONTRASTS, CONTRAST_KEYS);
  protected readonly shapeOptions = translatedOptions(THEME_SHAPES, SHAPE_KEYS);
  protected readonly fontOptions = translatedOptions(THEME_FONTS, FONT_KEYS);
  private readonly contrastSystemHint = translateSignal(CONTRAST_SYSTEM_HINT_KEY);
  protected readonly contrastHint = computed(() =>
    this.personal().contrast === 'system' ? this.contrastSystemHint() : undefined,
  );

  protected setMode(mode: ThemeMode | undefined): void {
    if (mode) this.personal.update((personal) => ({ ...personal, mode }));
  }

  protected setContrast(contrast: ThemeContrast | undefined): void {
    if (contrast) this.personal.update((personal) => ({ ...personal, contrast }));
  }

  /** Own colors start from the installation's colors, so switching them on changes nothing yet. */
  protected setOwnColors(own: boolean): void {
    this.personal.update(({ mode, contrast }) =>
      own ? { mode, contrast, colors: this.instance().colors } : { mode, contrast },
    );
  }

  protected setPersonalColors(colors: ThemeColors): void {
    this.personal.update((personal) => ({ ...personal, colors }));
  }

  protected setInstanceColors(colors: ThemeColors): void {
    this.instance.update((instance) => ({ ...instance, colors }));
  }

  protected setShape(shape: ThemeShape | undefined): void {
    if (shape) this.instance.update((instance) => ({ ...instance, shape }));
  }

  protected setFont(font: ThemeFont | undefined): void {
    if (font) this.instance.update((instance) => ({ ...instance, font }));
  }
}
```

`theme-editor.html`:

<!-- prettier-ignore -->
```html
<ui-stack gap="xl">
  @if (mode() === 'personal') {
    <ui-section [heading]="'ui.themeEditor.display' | transloco">
      <ui-stack gap="md">
        <ui-segmented-button
          [label]="'ui.themeEditor.mode' | transloco"
          [options]="modeOptions()"
          [value]="personal().mode"
          (valueChange)="setMode($event)"
        />
        <ui-select
          [label]="'ui.themeEditor.contrast' | transloco"
          [options]="contrastOptions()"
          [value]="personal().contrast"
          [hint]="contrastHint()"
          (valueChange)="setContrast($event)"
        />
      </ui-stack>
    </ui-section>
    <ui-section [heading]="'ui.themeEditor.colors' | transloco">
      <ui-stack gap="md">
        <ui-switch
          [label]="'ui.themeEditor.ownColors' | transloco"
          [checked]="!!personal().colors"
          (checkedChange)="setOwnColors($event)"
        />
        @if (personal().colors; as colors) {
          <ui-theme-colors [colors]="colors" (colorsChange)="setPersonalColors($event)" />
        } @else {
          <p class="note">{{ 'ui.themeEditor.installationColors' | transloco }}</p>
        }
      </ui-stack>
    </ui-section>
  } @else {
    <ui-section [heading]="'ui.themeEditor.colors' | transloco">
      <ui-theme-colors [colors]="instance().colors" (colorsChange)="setInstanceColors($event)" />
    </ui-section>
    <ui-section [heading]="'ui.themeEditor.shapeAndFont' | transloco">
      <ui-stack gap="md">
        <ui-select
          [label]="'ui.themeEditor.shape' | transloco"
          [options]="shapeOptions()"
          [value]="instance().shape"
          (valueChange)="setShape($event)"
        />
        <ui-select
          [label]="'ui.themeEditor.font' | transloco"
          [options]="fontOptions()"
          [value]="instance().font"
          (valueChange)="setFont($event)"
        />
      </ui-stack>
    </ui-section>
  }
  <ui-stack align="start">
    <ui-button variant="outlined" icon="refresh" (pressed)="reset.emit()">
      {{ 'ui.themeEditor.reset' | transloco }}
    </ui-button>
  </ui-stack>
</ui-stack>
```

`theme-editor.scss`:

```scss
:host {
  display: block;
  min-width: 0;
}

.note {
  margin: 0;
  color: var(--mat-sys-on-surface-variant);
  font: var(--mat-sys-body-medium);
}
```

`public-api.ts`: `export { UiThemeEditor, type UiThemeEditorMode } from './lib/theme-editor/theme-editor';`

Run: `pnpm --filter @smart/frontend exec ng test ui --watch=false && pnpm i18n:check`
Expected: PASS; `i18n:check` zweimal `ok`.

- [ ] **Step 4: Stories**

`apps/frontend/projects/ui/src/lib/theme-editor/theme-editor-live.story-component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ThemeService } from '../theme/theme.service';
import { UiThemeEditor } from './theme-editor';

/** Storybook only: the personal editor wired to the ThemeService, as the settings page will be in 3d. */
@Component({
  selector: 'ui-theme-editor-live',
  imports: [UiThemeEditor],
  template: `<ui-theme-editor
    mode="personal"
    [instance]="theme.instance()"
    [personal]="theme.personal()"
    (personalChange)="theme.setPersonal($event)"
    (reset)="theme.resetPersonal()"
  />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeEditorLiveStoryComponent {
  protected readonly theme = inject(ThemeService);
}
```

`apps/frontend/projects/ui/src/lib/theme-editor/theme-editor.stories.ts`:

```ts
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { DEFAULT_INSTANCE_APPEARANCE, DEFAULT_PERSONAL_APPEARANCE } from '@smart/contracts';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, userEvent, waitFor } from 'storybook/test';
import {
  expectNoBrokenWords,
  expectNoHorizontalOverflow,
  withPhoneFrame,
} from '../testing/story-helpers';
import { ThemeEditorLiveStoryComponent } from './theme-editor-live.story-component';
import { UiThemeEditor } from './theme-editor';

const meta: Meta<UiThemeEditor> = {
  title: 'Theme/Theme-Editor',
  component: UiThemeEditor,
  decorators: [
    applicationConfig({
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    }),
  ],
  args: { instance: DEFAULT_INSTANCE_APPEARANCE, personal: DEFAULT_PERSONAL_APPEARANCE },
};
export default meta;

const editor = (mode: 'personal' | 'instance') =>
  `<ui-theme-editor mode="${mode}" [(instance)]="instance" [(personal)]="personal" />`;

/** Segments and color swatches are sized by the editor; both must be 48 × 48 px or larger. */
const expectTouchTargets = async (root: Element) => {
  for (const control of root.querySelectorAll<HTMLElement>('[role="radio"], .swatch')) {
    const { height, width } = control.getBoundingClientRect();
    await expect(height, control.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(48);
    await expect(width, control.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(48);
  }
};

export const Persoenlich: StoryObj<UiThemeEditor> = {
  render: (args) => ({ props: { ...args }, template: editor('personal') }),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('radiogroup')).toBeVisible();
    await userEvent.click(canvas.getAllByRole('radio')[2]!);
    await expect(canvas.getAllByRole('radio')[2]).toBeChecked();
    await userEvent.click(canvas.getAllByRole('switch')[0]!);
    await waitFor(() => expect(canvasElement.querySelector('ui-theme-colors')).not.toBeNull());
    await expectTouchTargets(canvasElement);
  },
};

export const Installation: StoryObj<UiThemeEditor> = {
  render: (args) => ({ props: { ...args }, template: editor('instance') }),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.queryByRole('radiogroup')).toBeNull();
    await expect(canvas.getAllByRole('combobox')).toHaveLength(3);
    await expectTouchTargets(canvasElement);
  },
};

// The narrowest phone, with every section open: no sideways scrolling, no word broken mid-word.
// The second test-runner pass repeats this in English.
export const Schmal: StoryObj<UiThemeEditor> = {
  decorators: [withPhoneFrame],
  args: {
    personal: { ...DEFAULT_PERSONAL_APPEARANCE, colors: DEFAULT_INSTANCE_APPEARANCE.colors },
  },
  render: (args) => ({
    props: { ...args },
    template: `<div style="display: grid; gap: 48px">${editor('personal')}${editor('instance')}</div>`,
  }),
  play: async ({ canvasElement }) => {
    const frame = canvasElement.querySelector('.story-narrow')!;
    await expectNoHorizontalOverflow(frame);
    await expectNoBrokenWords(frame);
    await expectTouchTargets(frame);
  },
};

/** Wired to the ThemeService: choosing "Dunkel" darkens the whole Storybook page. */
export const Live: StoryObj<UiThemeEditor> = {
  decorators: [moduleMetadata({ imports: [ThemeEditorLiveStoryComponent] })],
  render: () => ({ template: '<ui-theme-editor-live />' }),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getAllByRole('radio')[2]!);
    await waitFor(() => expect(document.documentElement.style.colorScheme).toBe('dark'));
  },
};
```

Run: `pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci`
Expected: PASS in beiden Durchläufen. Scheitert `Schmal` an `expectNoBrokenWords` beim Modus (drei Segmente in 288 px, im zweiten Durchlauf Englisch), wird der Modus ebenfalls ein `ui-select` – Ruling festhalten. Scheitert es an Hinweistexten, gilt der Hinweis aus Task 7 Step 4 (`overflow-wrap: normal`).

- [ ] **Step 5: Prüfen und committen**

Run: Prüfung am Ende der Task (Global Constraints) einschließlich der Storybook-Prüfung.

```bash
git add apps/frontend/projects/ui
git commit -m "feat(ui): add the theme editor for personal and installation appearance"
```

---

### Task 10: Doku und Abschluss

**Files:**

- Modify: `apps/frontend/projects/ui/README.md`, `apps/frontend/projects/ui/src/lib/einfuehrung.mdx`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-10-11-etappe-3-design-system-design.md`

- [ ] **Step 1: README der Bibliothek**

In `apps/frontend/projects/ui/README.md`:

- Tabelle „Bausteine“: Zeile „Bedienung“ um `ui-select` ergänzen; neue Zeile `| Theme | ui-theme-editor (Modi personal/instance), ThemeService, provideTheme |`.
- Neuer Abschnitt nach der Tabelle:

```markdown
## Texte und Sprache

Einfache Komponenten bekommen ihre Texte übersetzt vom Aufrufer (Inputs wie `label`, `heading`, `description`). Zusammengesetzte Komponenten wie `ui-theme-editor` bringen eigene Texte mit: Schlüssel unter `ui.*` in `src/i18n/de.json` und `en.json`. Die App und Storybook mischen sie über `loadUiTranslation(language)` in ihre Wurzelübersetzung.

- Schlüssel, die erst zur Laufzeit gewählt werden (z. B. Optionen aus einer Liste), mit `marker('ui.…')` aus `@jsverse/transloco-keys-manager/marker` markieren.
- `pnpm i18n:check` (Teil von `pnpm lint`) meldet fehlende und ungenutzte Schlüssel; ESLint (`smart/no-literal-template-text`) verbietet Text im Template ohne Schlüssel.
- Unit-Tests übersetzen mit `provideUiTranslocoTesting(language)` aus `src/lib/testing/i18n-testing.ts`.
```

- [ ] **Step 2: Einführung in Storybook**

In `einfuehrung.mdx`:

- Satz zur Werkzeugleiste: „… stellt Grundfarbe, Variante, Modus, Kontrast, Formen, Schrift und Sprache um – über denselben `ThemeService` wie die App.“
- Regel „Kein Text in Komponenten“ ersetzen durch: „**Texte nur übersetzt:** Beschriftungen kommen übersetzt vom Aufrufer; Komponenten mit eigenen Texten (Theme-Editor) nutzen Schlüssel unter `ui.*`.“
- Regel „Barrierefreiheit“: „… im Standard-Theme und dunkel mit hohem Kontrast auf Englisch geprüft …“.

- [ ] **Step 3: CLAUDE.md**

- Tabelle „Befehle“: Zeile `| Übersetzungsschlüssel prüfen (auch in pnpm lint) | pnpm i18n:check |`.
- Abschnitt „Architekturregeln“, Punkt „Frontend-UI“ ergänzen: „kein sichtbarer Text ohne Übersetzungsschlüssel (ESLint `smart/no-literal-template-text`, `pnpm i18n:check`)“.
- Nach der Portzeile: „Laufzeitkonfiguration der Web-App: `SMART_INSTANCE_APPEARANCE_EDITOR`, `SMART_INSTANCE_APPEARANCE` → `/config.json` (siehe `docs/runbooks/provisioning.md`).“

- [ ] **Step 4: Spec Etappe 3, Abschnitt 5**

Tabelle „Komponenten“: Zeile „Bedienung“ um `ui-select` ergänzen; darunter einen Satz anfügen: „`ui-select` kam mit Plan 3c dazu: Auswahlen mit vier und mehr oder langen Optionen passen auf dem schmalsten Handy nicht in einen Segmented Button.“

- [ ] **Step 5: Gesamtprüfung und Commit**

Run (vollständig, in dieser Reihenfolge):

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:tz && pnpm build \
  && pnpm licenses:check \
  && pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci \
  && sh infra/compose/test/stack-test.sh \
  && git grep -nE -f .local/private-patterns.txt -- . ; echo "private scan exit=$? (1 = keine Treffer)"
```

Expected: alles grün; der App-Build meldet die initiale Größe unter 500 kB; der Private-Scan findet nichts.

```bash
git add apps/frontend/projects/ui/README.md apps/frontend/projects/ui/src/lib/einfuehrung.mdx CLAUDE.md docs/superpowers/specs
git commit -m "docs: describe translations, runtime configuration and the theme editor"
```

---

## Ergebnis und Übertrag

Umgesetzt subagent-gestützt (Umsetzung und Review je Task mit Sonnet, Task 6 und 10 mit Haiku, Gesamt-Review mit Opus und einer Nachbesserungsrunde). Dieser Abschnitt hält fest, wo die Umsetzung vom Plan abweicht und was Plan 3d übernehmen muss.

### Abweichungen vom Plan (Entscheidungen)

- **Text-Regel (Task 1):** Die Regel prüft nicht nur wörtliche Texte und Text-Attribute, sondern läuft durch die Ausdrücke von Interpolationen und gebundenen Text-Attributen (Bedingungen, Verkettungen, Template-Strings). Erlaubt sind Zeichenketten nur als direkte Eingabe der `transloco`-Pipe. `apps/frontend/src/index.html` ist ausgenommen (statische Hülle mit dem Markennamen im `<title>`). Nach dem Gesamt-Review gilt auch `headline` als Text-Attribut; ein Test vergleicht alle `string`-Eingaben der Bibliothek mit der Liste, damit neue Text-Eingaben nicht durchrutschen.
- **Graue Overrides (Task 3):** Schwelle bleibt bei Buntheit 6; die Testfarbe ist `#7a7d80` statt `#7a7f85` (Buntheit 7,3, sichtbar bläulich). Ein älterer Test nutzt statt eines Graus `#9a8686`.
- **Chips (Task 6):** `[disabled]` sitzt zusätzlich an jeder Chip-Option, weil Material den Zustand der Liste nur an bereits gerenderte Chips weitergibt.
- **Auswahlfeld (Task 7):** Die 48-px-Prüfung misst den umrandeten Feldcontainer (56 px), nicht die 24 px hohe Textzeile; ein Klick irgendwo im Container öffnet die Liste.
- **Farbvorschläge (Task 8):** Die gewählte Farbe zeigt einen dicken Rand in `--mat-sys-on-surface` statt des doppelten Schattenrings (Stylelint lässt zusammengesetzte Schatten nicht zu).
- **Theme-Editor (Task 9):** Die Ausgabe heißt `resetRequested` statt `reset` (`@angular-eslint/no-output-native`). Der Modus bleibt ein Segmented Button; bei 288 px bricht kein Wort.
- **Storybook (Gesamt-Review):** Die Werkzeugleiste wartet nicht von selbst auf geladene Übersetzungen. Stories mit Text rufen zu Beginn `waitForTranslations()` aus `lib/testing/storybook-environment.ts` auf; ohne das prüften die Editor-Stories ein leeres DOM. Die Sprache der Werkzeugleiste und der App setzt jetzt auch `UiFormatContext.locale` (Datums- und Zeitangaben auf Englisch).
- **Container-Skript:** Kein `SMART_CONFIG_TARGET`; die Datei liegt fest unter `/tmp/smart-config.json` (passend zum nginx-Alias). Kaputtes JSON in `SMART_INSTANCE_APPEARANCE` macht die ganze `config.json` unbrauchbar – auch der Editor-Schalter fällt dann auf aus (im Runbook beschrieben).

### Übertrag in Plan 3d

- **Seiten binden den Editor** so: `<ui-theme-editor mode="personal" [instance]="theme.instance()" [personal]="theme.personal()" (personalChange)="theme.setPersonal($event)" (resetRequested)="theme.resetPersonal()" />` (Muster: Live-Story).
- **Sprache:** aktive Sprache vor dem ersten Rendern laden (App-Initializer), sonst kurz leere Texte; Sprachwahl zwischen Tabs abgleichen wie das Theme; Schlüsselprüfung um Feature-Scopes erweitern (`scopePathMap`), sobald Features eigene Übersetzungen bekommen. Regel festhalten: Texte in TypeScript (Optionen, Snackbar-Meldungen) nur über `marker()`/`translatedOptions`, die Template-Regel sieht sie nicht.
- **PWA:** `config.json` gehört in eine `dataGroup` mit Frische-Strategie und kurzem Timeout, nicht in eine Asset-Gruppe (die Datei im Image ist die Entwicklungsdatei, der Container liefert seine eigene).
- **Staging:** `infra/deploy/provision.sh` schreibt `SMART_INSTANCE_APPEARANCE_EDITOR=true` nicht, und `--force` würde von Hand ergänzte `SMART_*`-Zeilen verwerfen – vor den Installations-Einstellungen auf Staging lösen.
- **Tests nachziehen:** Abgleich der Instanz zwischen Tabs (auch bei ausgeschaltetem Editor), Bearbeiten eines bestehenden Overrides im Farbteil, Reset im Installationsmodus.
- **Leistung:** `ThemeService.apply()` berechnet bei Kontrast „System“ fünf Variablensätze je Änderung; beim Ziehen im Farbwähler ggf. entprellen.
- Aus 3b weiterhin offen: Snackbar-Schließen, Banner-Ansage, Überschriftenebenen, Umbruch, Button-Link-Modus, Liste (siehe Plan 3b).

### Bewusst zurückgestellt (klein)

- Schlüsselprüfung: `spawnSync`-Fehler (`ENOENT`) ohne Meldung, kein Timeout, kaputte Konfiguration wirft statt Problem-Eintrag, Sprachen fest statt aus `LANGUAGES`, Ausgabe-Wächter ungetestet.
- Theme: `storage`-Ereignis prüft `storageArea` nicht; Boot-Cache-Version ist jetzt per Test verknüpft.
- Laufzeitkonfiguration: 404 ohne Warnung; unquotiertes JSON-Beispiel in `.env.example` ungetestet.
- Komponenten: Kommentar zur Chip-Bindung; Story-Prüfung über private Material-Klasse; `withPhoneFrame` dupliziert `withNarrowFrame`; offene Auswahlliste bei schmaler Breite ungeprüft; gewählte Farbfläche wird durch den dicken Rand 4 px kleiner; `setOwnColors` übernimmt künftige Felder nicht; Zielflächen-Prüfung im Editor nur für Segmente und Farbflächen.
- Storybook: `translationsReady` ist modulweit; Live-Story verlässt sich darauf, dass `whenStable()` den Theme-Effekt abgeschlossen hat; deutsche Beschriftungen in der Zeit-Demo.
- Spec 5 nennt `ui-chip`, die Bibliothek hat `ui-chip-set`.
