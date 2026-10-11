# Etappe 3a: Theme-Engine und UI-Fundament – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Theme der App wird aus einer validierten Konfiguration berechnet (wie im Material Theme Builder), ist vor dem ersten Skript korrekt eingefärbt, wechselt live ohne Aufblitzen und lässt sich im öffentlichen Storybook in allen Kombinationen ansehen.

**Architecture:** `@smart/contracts` beschreibt das Erscheinungsbild (Zod). Das framework-freie Paket `@smart/theme` rechnet daraus mit `material-color-utilities` alle CSS-Variablen (`--mat-sys-*`, `--smart-*`) und erzeugt beim Build das Standard-CSS. Die neue Angular-Bibliothek `@smart/ui` kapselt Angular Material, die selbst gehosteten Schriften und den `ThemeService`; ein externes `theme-boot.js` setzt das zuletzt berechnete Theme vor dem Angular-Start. Storybook zeigt die Farbrollen und wird über GitHub Pages veröffentlicht.

**Tech Stack:** Angular 22.2 + Angular Material/CDK 22.2.2, `@material/material-color-utilities` 0.3.0, Zod 4.6.5, Vitest 5, Storybook 10.6.1 (`@storybook/angular`, `@storybook/addon-a11y`, `@storybook/test-runner` 0.26.0, `axe-playwright` 2.2.2), Fontsource (Roboto Flex, Figtree, Atkinson Hyperlegible Next), `material-symbols` 0.48.0.

**Spec:** `docs/superpowers/specs/2026-10-11-etappe-3-design-system-design.md` (Abschnitte 4, 6, 9, 10) – Etappe 3 wird in drei Pläne geteilt: **3a** (dieser Plan), **3b** Komponenten, **3c** App-Rahmen, Seiten, Sprache, PWA, App-Icon.

**Bewusst nicht in 3a:** Laufzeitkonfiguration `config.json` (Spec 4.5 Punkt 4) samt Feature-Schalter `features.instanceAppearanceEditor` – beides gehört zum App-Rahmen und kommt in 3c; 3a bereitet sie über `provideTheme({ instance })` vor. Der Theme-Editor (`ui-theme-editor`) kommt in 3c, `deriveKeyColors` liefert ihm hier schon die Kernfarben.

## Global Constraints

- Node 24.21.0, pnpm 12.11.2, TypeScript 6.0.3, Angular 22.2.x – wie bisher.
- `@material/material-color-utilities` **exakt 0.3.0**. (0.4.0 ist als ESM in Node nicht ladbar – fehlende Dateiendungen in Importen; Tests und Build-Skript laufen in Node.)
- Neue Pakete exakt: `@angular/material@22.2.2`, `@angular/cdk@22.2.2`, `@angular-devkit/build-angular@22.2.2` (nur für Storybook), `storybook@10.6.1`, `@storybook/angular@10.6.1`, `@storybook/addon-a11y@10.6.1`, `@storybook/addon-docs@10.6.1`, `@storybook/test-runner@0.26.0`, `axe-playwright@2.2.2`, `@fontsource-variable/roboto-flex@5.3.0`, `@fontsource-variable/figtree@5.3.0`, `@fontsource-variable/atkinson-hyperlegible-next@5.3.0`, `material-symbols@0.48.0`, `@types/node@24.19.2` (Frontend, nur Specs), `http-server@14.1.1`, `wait-on@9.1.0`, `concurrently@10.0.5`.
- Feste Maße (`px`, `rem`) nur in `apps/frontend/projects/ui/src/lib/tokens/` (Stylelint). Abstände über `--smart-space-*` (Task 5), Linienbreite über `--smart-border-width`.
- Standard-Erscheinungsbild (Spec 4.1): Grundfarbe `#00687a`, Variante `tonalSpot`, Farbtreue aus, keine Overrides, Formen `standard`, Schrift `roboto-flex`, Modus `system`, Kontrast `system` (= Standard, bei `prefers-contrast: more` Hoch).
- CSS-Variablennamen der Farbrollen exakt wie Angular Material 22: `--mat-sys-<rolle>` (49 Rollen, siehe Task 2) plus `--mat-sys-neutral10`, `--mat-sys-neutral-variant20`.
- Eigene Variablen: `--smart-status-<name>`, `--smart-status-on-<name>`, `--smart-status-<name>-container`, `--smart-status-on-<name>-container` für `dry`, `ok`, `wet`, `warning`, `offline`; `--smart-font-family`.
- Variablen werden zur Laufzeit per CSSOM (`style.setProperty`) gesetzt, nie als Inline-`<style>` oder Inline-Skript (strikte CSP).
- Browser-Speicher nur mit `try/catch`; die App funktioniert ohne.
- Bestehende Regeln gelten: kein Material außerhalb `@smart/ui`, keine Komponenten-Styles außerhalb `@smart/ui`, in `@smart/ui` nur Tokens (Stylelint), Code Englisch, Doku Deutsch, Conventional Commits ohne KI-Attribution.
- Arbeit auf Branch `feat/etappe-3a-theme` (abgezweigt von `docs/etappe-3-spec`, der Spec und Plan enthält).

## Review Focus

1. **Kontrast in Randkombinationen** (Monochrome/Neutral, dunkel, Kontrast Hoch, sehr helle oder sehr dunkle Grundfarbe wie `#ffff00` oder `#101010`): Text muss lesbar bleiben. → Kontrast-Matrix-Test in Task 2.
2. **Ungültige oder veraltete gespeicherte Daten** (beschädigtes JSON, unbekannte Variante aus einer älteren Version): App startet mit Standard statt zu crashen. → Tests in Task 6 (Store) und Task 6 (theme-boot).
3. **Aufblitzen beim Laden** (gespeichertes dunkles Theme, Seite lädt erst hell): `theme-boot.js` muss vor Angular greifen, auch wenn das App-Bundle langsam oder blockiert ist. → Playwright-Test in Task 6.
4. **Systemwechsel zur Laufzeit** (iPhone schaltet abends auf Dunkel, „Kontrast erhöhen“ wird aktiviert): Theme folgt live, solange der Nutzer `system` gewählt hat. → ThemeService-Test in Task 6.
5. **Standard-CSS veraltet** (Engine geändert, generierte Datei nicht neu erzeugt): CI muss das erkennen. → Aktualitätstest in Task 4.

---

### Task 1: Erscheinungsbild-Schemas in `@smart/contracts`

**Files:**

- Create: `packages/contracts/src/appearance.ts`, `packages/contracts/src/appearance.spec.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**

- Produces: `THEME_VARIANTS`, `CORE_COLOR_IDS`, `themeColorsSchema`, `instanceAppearanceSchema`, `personalAppearanceSchema`; Typen `ThemeVariant`, `CoreColorId`, `ThemeColors`, `ThemeShape` (`'kantig' | 'standard' | 'weich'`), `ThemeFont` (`'roboto-flex' | 'figtree' | 'atkinson'`), `ThemeMode` (`'system' | 'light' | 'dark'`), `ThemeContrast` (`'system' | 'standard' | 'medium' | 'high'`), `InstanceAppearance`, `PersonalAppearance`; Konstanten `DEFAULT_INSTANCE_APPEARANCE`, `DEFAULT_PERSONAL_APPEARANCE`.

- [ ] **Step 1: Branch und Failing tests**

```bash
git switch docs/etappe-3-spec && git switch -c feat/etappe-3a-theme
```

`packages/contracts/src/appearance.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INSTANCE_APPEARANCE,
  DEFAULT_PERSONAL_APPEARANCE,
  instanceAppearanceSchema,
  personalAppearanceSchema,
  themeColorsSchema,
} from './appearance.js';

describe('appearance schemas', () => {
  it('accepts the defaults', () => {
    expect(instanceAppearanceSchema.parse(DEFAULT_INSTANCE_APPEARANCE)).toEqual(
      DEFAULT_INSTANCE_APPEARANCE,
    );
    expect(personalAppearanceSchema.parse(DEFAULT_PERSONAL_APPEARANCE)).toEqual(
      DEFAULT_PERSONAL_APPEARANCE,
    );
  });

  it('defines the agreed default look', () => {
    expect(DEFAULT_INSTANCE_APPEARANCE).toEqual({
      colors: { seed: '#00687a', variant: 'tonalSpot', colorMatch: false, coreOverrides: {} },
      shape: 'standard',
      font: 'roboto-flex',
    });
    expect(DEFAULT_PERSONAL_APPEARANCE).toEqual({ mode: 'system', contrast: 'system' });
  });

  it('accepts partial core color overrides', () => {
    const colors = {
      seed: '#8a5a00',
      variant: 'vibrant',
      colorMatch: true,
      coreOverrides: { primary: '#6F9D2F', error: '#e8604c' },
    };
    expect(themeColorsSchema.parse(colors).coreOverrides).toEqual({
      primary: '#6F9D2F',
      error: '#e8604c',
    });
  });

  it('fills missing core overrides with an empty object', () => {
    expect(
      themeColorsSchema.parse({ seed: '#00687a', variant: 'neutral', colorMatch: false })
        .coreOverrides,
    ).toEqual({});
  });

  it.each([
    { seed: 'teal', variant: 'tonalSpot', colorMatch: false },
    { seed: '#00687', variant: 'tonalSpot', colorMatch: false },
    { seed: '#00687a', variant: 'rainbow', colorMatch: false },
    {
      seed: '#00687a',
      variant: 'tonalSpot',
      colorMatch: false,
      coreOverrides: { accent: '#ffffff' },
    },
    { seed: '#00687a', variant: 'tonalSpot', colorMatch: false, coreOverrides: { primary: 'red' } },
  ])('rejects invalid colors %j', (colors) => {
    expect(themeColorsSchema.safeParse(colors).success).toBe(false);
  });

  it.each([
    { mode: 'auto', contrast: 'system' },
    { mode: 'system', contrast: 'max' },
  ])('rejects invalid personal settings %j', (personal) => {
    expect(personalAppearanceSchema.safeParse(personal).success).toBe(false);
  });

  it('keeps personal colors optional', () => {
    expect(
      personalAppearanceSchema.parse({ mode: 'dark', contrast: 'high' }).colors,
    ).toBeUndefined();
  });
});
```

- [ ] **Step 2: Test laufen lassen – muss fehlschlagen**

Run: `pnpm --filter @smart/contracts exec vitest run src/appearance.spec.ts`
Expected: FAIL – `Cannot find module './appearance.js'`.

- [ ] **Step 3: Implementierung**

`packages/contracts/src/appearance.ts`:

```ts
import { z } from 'zod';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb');

export const THEME_VARIANTS = [
  'tonalSpot',
  'neutral',
  'vibrant',
  'expressive',
  'fidelity',
  'content',
  'monochrome',
] as const;
export const CORE_COLOR_IDS = [
  'primary',
  'secondary',
  'tertiary',
  'error',
  'neutral',
  'neutralVariant',
] as const;

export const themeColorsSchema = z.object({
  seed: hexColor,
  variant: z.enum(THEME_VARIANTS),
  colorMatch: z.boolean(),
  coreOverrides: z.partialRecord(z.enum(CORE_COLOR_IDS), hexColor).default({}),
});

export const instanceAppearanceSchema = z.object({
  colors: themeColorsSchema,
  shape: z.enum(['kantig', 'standard', 'weich']),
  font: z.enum(['roboto-flex', 'figtree', 'atkinson']),
});

export const personalAppearanceSchema = z.object({
  colors: themeColorsSchema.optional(),
  mode: z.enum(['system', 'light', 'dark']),
  contrast: z.enum(['system', 'standard', 'medium', 'high']),
});

export type ThemeVariant = (typeof THEME_VARIANTS)[number];
export type CoreColorId = (typeof CORE_COLOR_IDS)[number];
export type ThemeColors = z.infer<typeof themeColorsSchema>;
export type InstanceAppearance = z.infer<typeof instanceAppearanceSchema>;
export type PersonalAppearance = z.infer<typeof personalAppearanceSchema>;
export type ThemeShape = InstanceAppearance['shape'];
export type ThemeFont = InstanceAppearance['font'];
export type ThemeMode = PersonalAppearance['mode'];
export type ThemeContrast = PersonalAppearance['contrast'];

export const DEFAULT_INSTANCE_APPEARANCE: InstanceAppearance = {
  colors: { seed: '#00687a', variant: 'tonalSpot', colorMatch: false, coreOverrides: {} },
  shape: 'standard',
  font: 'roboto-flex',
};

export const DEFAULT_PERSONAL_APPEARANCE: PersonalAppearance = {
  mode: 'system',
  contrast: 'system',
};
```

In `packages/contracts/src/index.ts` ergänzen: `export * from './appearance.js';`

- [ ] **Step 4: Tests laufen lassen – müssen bestehen**

Run: `pnpm --filter @smart/contracts test`
Expected: PASS (bisherige 25 + neue Fälle).

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/contracts
git commit -m "feat(contracts): add appearance schemas and defaults"
```

---

### Task 2: Theme-Engine `@smart/theme`

**Files:**

- Create: `packages/theme/package.json`, `packages/theme/tsconfig.json`, `packages/theme/tsconfig.build.json`, `packages/theme/vitest.config.ts`
- Create: `packages/theme/src/{index.ts, roles.ts, scheme.ts, status.ts, shape-font.ts, resolve.ts, vars.ts, contrast.ts}`
- Create: `packages/theme/src/theme.spec.ts`

**Interfaces:**

- Consumes: Typen und Defaults aus Task 1.
- Produces (`@smart/theme`):
  - `type ResolvedMode = 'light' | 'dark'`, `type ResolvedContrast = 'standard' | 'medium' | 'high'`
  - `interface ResolvedAppearance { colors: ThemeColors; shape: ThemeShape; font: ThemeFont; mode: ResolvedMode; contrast: ResolvedContrast }`
  - `interface SystemPreferences { prefersDark: boolean; prefersMoreContrast: boolean }`
  - `resolveAppearance(instance: InstanceAppearance, personal: PersonalAppearance, system: SystemPreferences): ResolvedAppearance`
  - `computeThemeVars(resolved: ResolvedAppearance): Record<string, string>` (Schlüssel inkl. `--`)
  - `deriveKeyColors(colors: ThemeColors): Record<CoreColorId, { hex: string; source: 'derived' | 'override' }>`
  - `contrastRatio(hexA: string, hexB: string): number`
  - `COLOR_ROLES: readonly string[]` (49 kebab-case Rollen), `STATUS_NAMES`

- [ ] **Step 1: Paket anlegen**

`packages/theme/package.json`:

```json
{
  "name": "@smart/theme",
  "version": "0.0.0",
  "license": "AGPL-3.0-only",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsc -p tsconfig.build.json --watch",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@material/material-color-utilities": "0.3.0",
    "@smart/contracts": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "24.19.2",
    "typescript": "6.0.3",
    "vitest": "5.0.3"
  }
}
```

`tsconfig.json`, `tsconfig.build.json` und `vitest.config.ts` als Kopie von `packages/contracts` (gleicher Inhalt). Dann `pnpm install`.

- [ ] **Step 2: Failing tests**

`packages/theme/src/theme.spec.ts`:

```ts
import {
  DEFAULT_INSTANCE_APPEARANCE,
  DEFAULT_PERSONAL_APPEARANCE,
  THEME_VARIANTS,
  type ThemeColors,
} from '@smart/contracts';
import { Hct, argbFromHex } from '@material/material-color-utilities';
import { describe, expect, it } from 'vitest';
import {
  COLOR_ROLES,
  STATUS_NAMES,
  computeThemeVars,
  contrastRatio,
  deriveKeyColors,
  resolveAppearance,
  type ResolvedAppearance,
} from './index.js';

const petrol: ThemeColors = DEFAULT_INSTANCE_APPEARANCE.colors;
const resolved = (overrides: Partial<ResolvedAppearance> = {}): ResolvedAppearance => ({
  colors: petrol,
  shape: 'standard',
  font: 'roboto-flex',
  mode: 'light',
  contrast: 'standard',
  ...overrides,
});
const hue = (hex: string) => Hct.fromInt(argbFromHex(hex)).hue;
const chroma = (hex: string) => Hct.fromInt(argbFromHex(hex)).chroma;
const hueDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

describe('computeThemeVars', () => {
  it('emits every Angular Material color role as a hex color', () => {
    const vars = computeThemeVars(resolved());
    expect(COLOR_ROLES).toHaveLength(49);
    for (const role of [...COLOR_ROLES, 'neutral10', 'neutral-variant20']) {
      expect(vars[`--mat-sys-${role}`], role).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('emits four roles per status color', () => {
    const vars = computeThemeVars(resolved());
    for (const name of STATUS_NAMES) {
      for (const key of [
        `--smart-status-${name}`,
        `--smart-status-on-${name}`,
        `--smart-status-${name}-container`,
        `--smart-status-on-${name}-container`,
      ]) {
        expect(vars[key], key).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('differs between light and dark', () => {
    expect(computeThemeVars(resolved({ mode: 'dark' }))['--mat-sys-surface']).not.toBe(
      computeThemeVars(resolved())['--mat-sys-surface'],
    );
  });

  it('sets corners per shape and the font family', () => {
    expect(computeThemeVars(resolved({ shape: 'kantig' }))['--mat-sys-corner-medium']).toBe('6px');
    expect(computeThemeVars(resolved({ shape: 'standard' }))['--mat-sys-corner-medium']).toBe(
      '12px',
    );
    expect(computeThemeVars(resolved({ shape: 'weich' }))['--mat-sys-corner-medium']).toBe('18px');
    expect(computeThemeVars(resolved())['--mat-sys-corner-full']).toBe('9999px');
    expect(computeThemeVars(resolved({ font: 'atkinson' }))['--smart-font-family']).toContain(
      'Atkinson Hyperlegible Next Variable',
    );
  });

  describe('keeps text readable in every combination', () => {
    const seeds = ['#00687a', '#ffff00', '#101010', '#ff0000', '#8a5a00'];
    const cases = THEME_VARIANTS.flatMap((variant) =>
      seeds.flatMap((seed) =>
        (['light', 'dark'] as const).flatMap((mode) =>
          (['standard', 'medium', 'high'] as const).map((contrast) => ({
            variant,
            seed,
            mode,
            contrast,
          })),
        ),
      ),
    );
    it.each(cases)('$variant $seed $mode $contrast', ({ variant, seed, mode, contrast }) => {
      const vars = computeThemeVars(
        resolved({
          colors: { seed, variant, colorMatch: false, coreOverrides: {} },
          mode,
          contrast,
        }),
      );
      const minText = contrast === 'high' ? 7 : 4.5;
      expect(
        contrastRatio(vars['--mat-sys-on-surface']!, vars['--mat-sys-surface']!),
      ).toBeGreaterThanOrEqual(minText);
      expect(
        contrastRatio(vars['--mat-sys-on-primary']!, vars['--mat-sys-primary']!),
      ).toBeGreaterThanOrEqual(4.5);
      for (const name of STATUS_NAMES) {
        expect(
          contrastRatio(
            vars[`--smart-status-on-${name}-container`]!,
            vars[`--smart-status-${name}-container`]!,
          ),
          name,
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(vars[`--smart-status-${name}`]!, vars['--mat-sys-surface']!),
          name,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  });

  it('harmonizes status colors towards the source by at most 15 degrees', () => {
    const vars = computeThemeVars(resolved());
    // Blend.harmonize rotates by at most 15 degrees; tone mapping adds up to ~2 degrees of HCT rounding.
    expect(hueDistance(hue(vars['--smart-status-ok']!), hue('#2e7d32'))).toBeLessThanOrEqual(17);
    expect(hueDistance(hue(vars['--smart-status-wet']!), hue('#1565c0'))).toBeLessThanOrEqual(17);
    expect(hueDistance(hue(vars['--smart-status-ok']!), hue('#2e7d32'))).toBeGreaterThan(0);
  });

  it('applies an error override', () => {
    const colors = { ...petrol, coreOverrides: { error: '#7b1fa2' } };
    const errorHue = hue(computeThemeVars(resolved({ colors }))['--mat-sys-error']!);
    expect(hueDistance(errorHue, hue('#7b1fa2'))).toBeLessThan(10);
  });

  it('keeps the override chroma only with colorMatch', () => {
    const override = { ...petrol, coreOverrides: { primary: '#6f9d2f' } };
    const matched = computeThemeVars(resolved({ colors: { ...override, colorMatch: true } }))[
      '--mat-sys-primary-container'
    ]!;
    const softened = computeThemeVars(resolved({ colors: override }))[
      '--mat-sys-primary-container'
    ]!;
    expect(hueDistance(hue(matched), hue('#6f9d2f'))).toBeLessThan(15);
    expect(chroma(matched)).toBeGreaterThan(chroma(softened));
  });
});

describe('deriveKeyColors', () => {
  it('derives every key color from the seed', () => {
    const keys = deriveKeyColors(petrol);
    for (const id of [
      'primary',
      'secondary',
      'tertiary',
      'error',
      'neutral',
      'neutralVariant',
    ] as const) {
      expect(keys[id].source).toBe('derived');
      expect(keys[id].hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('follows a new seed', () => {
    const amber = deriveKeyColors({ ...petrol, seed: '#8a5a00' });
    expect(amber.secondary.hex).not.toBe(deriveKeyColors(petrol).secondary.hex);
    expect(amber.neutral.hex).not.toBe(deriveKeyColors(petrol).neutral.hex);
  });

  it('uses a primary override as the source for the others', () => {
    const withPrimary = deriveKeyColors({ ...petrol, coreOverrides: { primary: '#6f9d2f' } });
    expect(withPrimary.primary).toEqual({ hex: '#6f9d2f', source: 'override' });
    expect(withPrimary.secondary.hex).not.toBe(deriveKeyColors(petrol).secondary.hex);
  });

  it('returns other overrides verbatim', () => {
    expect(deriveKeyColors({ ...petrol, coreOverrides: { tertiary: '#5F9EA0' } }).tertiary).toEqual(
      { hex: '#5f9ea0', source: 'override' },
    );
  });
});

describe('resolveAppearance', () => {
  const system = { prefersDark: false, prefersMoreContrast: false };

  it('uses instance colors, shape and font by default', () => {
    expect(
      resolveAppearance(DEFAULT_INSTANCE_APPEARANCE, DEFAULT_PERSONAL_APPEARANCE, system),
    ).toEqual({
      colors: petrol,
      shape: 'standard',
      font: 'roboto-flex',
      mode: 'light',
      contrast: 'standard',
    });
  });

  it('replaces the color block as a unit when the user has own colors', () => {
    const own: ThemeColors = {
      seed: '#6e4c7e',
      variant: 'vibrant',
      colorMatch: true,
      coreOverrides: {},
    };
    const instance = {
      ...DEFAULT_INSTANCE_APPEARANCE,
      colors: { ...petrol, coreOverrides: { tertiary: '#5f9ea0' } },
    };
    expect(
      resolveAppearance(instance, { ...DEFAULT_PERSONAL_APPEARANCE, colors: own }, system).colors,
    ).toEqual(own);
  });

  it('always takes shape and font from the instance', () => {
    const instance = {
      ...DEFAULT_INSTANCE_APPEARANCE,
      shape: 'weich' as const,
      font: 'figtree' as const,
    };
    const result = resolveAppearance(instance, DEFAULT_PERSONAL_APPEARANCE, system);
    expect([result.shape, result.font]).toEqual(['weich', 'figtree']);
  });

  it('follows the system for mode and contrast', () => {
    const result = resolveAppearance(DEFAULT_INSTANCE_APPEARANCE, DEFAULT_PERSONAL_APPEARANCE, {
      prefersDark: true,
      prefersMoreContrast: true,
    });
    expect([result.mode, result.contrast]).toEqual(['dark', 'high']);
  });

  it('lets explicit choices win over the system', () => {
    const result = resolveAppearance(
      DEFAULT_INSTANCE_APPEARANCE,
      { mode: 'light', contrast: 'medium' },
      { prefersDark: true, prefersMoreContrast: true },
    );
    expect([result.mode, result.contrast]).toEqual(['light', 'medium']);
  });
});

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
});
```

- [ ] **Step 3: Tests laufen lassen – müssen fehlschlagen**

Run: `pnpm contracts:build && pnpm --filter @smart/theme test`
Expected: FAIL – `Cannot find module './index.js'`.

- [ ] **Step 4: Implementierung**

`packages/theme/src/roles.ts`:

```ts
/** Every color role Angular Material 22 reads as --mat-sys-<role> (kebab-case). */
export const COLOR_ROLES = [
  'primary',
  'on-primary',
  'primary-container',
  'on-primary-container',
  'primary-fixed',
  'primary-fixed-dim',
  'on-primary-fixed',
  'on-primary-fixed-variant',
  'secondary',
  'on-secondary',
  'secondary-container',
  'on-secondary-container',
  'secondary-fixed',
  'secondary-fixed-dim',
  'on-secondary-fixed',
  'on-secondary-fixed-variant',
  'tertiary',
  'on-tertiary',
  'tertiary-container',
  'on-tertiary-container',
  'tertiary-fixed',
  'tertiary-fixed-dim',
  'on-tertiary-fixed',
  'on-tertiary-fixed-variant',
  'error',
  'on-error',
  'error-container',
  'on-error-container',
  'background',
  'on-background',
  'surface',
  'on-surface',
  'surface-variant',
  'on-surface-variant',
  'surface-container-lowest',
  'surface-container-low',
  'surface-container',
  'surface-container-high',
  'surface-container-highest',
  'surface-bright',
  'surface-dim',
  'surface-tint',
  'inverse-surface',
  'inverse-on-surface',
  'inverse-primary',
  'outline',
  'outline-variant',
  'shadow',
  'scrim',
] as const;

export const toCamel = (role: string): string =>
  role.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
```

`packages/theme/src/scheme.ts`:

```ts
import {
  DynamicScheme,
  Hct,
  SchemeContent,
  SchemeExpressive,
  SchemeFidelity,
  SchemeMonochrome,
  SchemeNeutral,
  SchemeTonalSpot,
  SchemeVibrant,
  TonalPalette,
  argbFromHex,
} from '@material/material-color-utilities';
import type { CoreColorId, ThemeColors, ThemeVariant } from '@smart/contracts';

export type ResolvedMode = 'light' | 'dark';
export type ResolvedContrast = 'standard' | 'medium' | 'high';

export const CONTRAST_LEVEL: Record<ResolvedContrast, number> = {
  standard: 0,
  medium: 0.5,
  high: 1,
};

const SCHEMES: Record<
  ThemeVariant,
  new (source: Hct, isDark: boolean, contrastLevel: number) => DynamicScheme
> = {
  tonalSpot: SchemeTonalSpot,
  neutral: SchemeNeutral,
  vibrant: SchemeVibrant,
  expressive: SchemeExpressive,
  fidelity: SchemeFidelity,
  content: SchemeContent,
  monochrome: SchemeMonochrome,
};

export const PALETTE_OF = {
  primary: 'primaryPalette',
  secondary: 'secondaryPalette',
  tertiary: 'tertiaryPalette',
  error: 'errorPalette',
  neutral: 'neutralPalette',
  neutralVariant: 'neutralVariantPalette',
} as const satisfies Record<CoreColorId, keyof DynamicScheme>;

/** Source color: a primary override acts as the source (Material Theme Builder behaviour). */
export function sourceArgb(colors: ThemeColors): number {
  return argbFromHex(colors.coreOverrides.primary ?? colors.seed);
}

export function buildScheme(
  colors: ThemeColors,
  mode: ResolvedMode,
  contrast: ResolvedContrast,
): DynamicScheme {
  const isDark = mode === 'dark';
  const level = CONTRAST_LEVEL[contrast];
  const source = sourceArgb(colors);
  const sourceHct = Hct.fromInt(source);
  const base = new SCHEMES[colors.variant](sourceHct, isDark, level);
  const overrides = colors.coreOverrides;
  if (!colors.colorMatch && Object.keys(overrides).length === 0) return base;

  // With colorMatch an override keeps its own chroma; otherwise only its hue is used.
  const palette = (id: CoreColorId, fallback: TonalPalette): TonalPalette => {
    const hex = overrides[id];
    if (!hex) return fallback;
    const argb = argbFromHex(hex);
    return colors.colorMatch
      ? TonalPalette.fromInt(argb)
      : TonalPalette.fromHueAndChroma(Hct.fromInt(argb).hue, fallback.chroma);
  };

  const scheme = new DynamicScheme({
    sourceColorArgb: source,
    // The library does not export the Variant enum; take Fidelity's value from a Fidelity scheme.
    variant: colors.colorMatch
      ? new SchemeFidelity(sourceHct, isDark, level).variant
      : base.variant,
    contrastLevel: level,
    isDark,
    primaryPalette: colors.colorMatch
      ? TonalPalette.fromInt(source)
      : palette('primary', base.primaryPalette),
    secondaryPalette: palette('secondary', base.secondaryPalette),
    tertiaryPalette: palette('tertiary', base.tertiaryPalette),
    neutralPalette: palette('neutral', base.neutralPalette),
    neutralVariantPalette: palette('neutralVariant', base.neutralVariantPalette),
  });
  if (overrides.error) {
    (scheme as unknown as { errorPalette: TonalPalette }).errorPalette = TonalPalette.fromInt(
      argbFromHex(overrides.error),
    );
  }
  return scheme;
}
```

`packages/theme/src/status.ts`:

```ts
import { Blend, TonalPalette, argbFromHex, hexFromArgb } from '@material/material-color-utilities';
import type { ResolvedContrast, ResolvedMode } from './scheme.js';

export const STATUS_NAMES = ['dry', 'ok', 'wet', 'warning', 'offline'] as const;
export type StatusName = (typeof STATUS_NAMES)[number];

const STATUS_SOURCES: Record<StatusName, string> = {
  dry: '#c77800',
  ok: '#2e7d32',
  wet: '#1565c0',
  warning: '#d84315',
  offline: '#6f7378',
};

/** Tones for [color, on-color, container, on-container]. */
const TONES: Record<ResolvedMode, Record<ResolvedContrast, [number, number, number, number]>> = {
  light: { standard: [40, 100, 90, 10], medium: [35, 100, 88, 5], high: [25, 100, 85, 0] },
  dark: { standard: [80, 20, 30, 90], medium: [85, 10, 25, 95], high: [90, 0, 15, 100] },
};

export function statusVars(
  source: number,
  mode: ResolvedMode,
  contrast: ResolvedContrast,
): Record<string, string> {
  const [color, onColor, container, onContainer] = TONES[mode][contrast];
  const vars: Record<string, string> = {};
  for (const name of STATUS_NAMES) {
    const palette = TonalPalette.fromInt(
      Blend.harmonize(argbFromHex(STATUS_SOURCES[name]), source),
    );
    vars[`--smart-status-${name}`] = hexFromArgb(palette.tone(color));
    vars[`--smart-status-on-${name}`] = hexFromArgb(palette.tone(onColor));
    vars[`--smart-status-${name}-container`] = hexFromArgb(palette.tone(container));
    vars[`--smart-status-on-${name}-container`] = hexFromArgb(palette.tone(onContainer));
  }
  return vars;
}
```

`packages/theme/src/shape-font.ts`:

```ts
import type { ThemeFont, ThemeShape } from '@smart/contracts';

const CORNERS: Record<ThemeShape, { xs: number; sm: number; md: number; lg: number; xl: number }> =
  {
    kantig: { xs: 2, sm: 4, md: 6, lg: 10, xl: 16 },
    standard: { xs: 4, sm: 8, md: 12, lg: 16, xl: 28 },
    weich: { xs: 6, sm: 12, md: 18, lg: 26, xl: 36 },
  };

export const FONT_FAMILIES: Record<ThemeFont, string> = {
  'roboto-flex': "'Roboto Flex Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
  figtree: "'Figtree Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
  atkinson:
    "'Atkinson Hyperlegible Next Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
};

export function shapeVars(shape: ThemeShape): Record<string, string> {
  const c = CORNERS[shape];
  return {
    '--mat-sys-corner-none': '0',
    '--mat-sys-corner-extra-small': `${c.xs}px`,
    '--mat-sys-corner-extra-small-top': `${c.xs}px ${c.xs}px 0 0`,
    '--mat-sys-corner-small': `${c.sm}px`,
    '--mat-sys-corner-medium': `${c.md}px`,
    '--mat-sys-corner-large': `${c.lg}px`,
    '--mat-sys-corner-large-top': `${c.lg}px ${c.lg}px 0 0`,
    '--mat-sys-corner-large-start': `${c.lg}px 0 0 ${c.lg}px`,
    '--mat-sys-corner-large-end': `0 ${c.lg}px ${c.lg}px 0`,
    '--mat-sys-corner-extra-large': `${c.xl}px`,
    '--mat-sys-corner-extra-large-top': `${c.xl}px ${c.xl}px 0 0`,
    '--mat-sys-corner-full': '9999px',
  };
}

export function fontVars(font: ThemeFont): Record<string, string> {
  return { '--smart-font-family': FONT_FAMILIES[font] };
}
```

`packages/theme/src/resolve.ts`:

```ts
import type {
  InstanceAppearance,
  PersonalAppearance,
  ThemeColors,
  ThemeFont,
  ThemeShape,
} from '@smart/contracts';
import type { ResolvedContrast, ResolvedMode } from './scheme.js';

export interface SystemPreferences {
  prefersDark: boolean;
  prefersMoreContrast: boolean;
}

export interface ResolvedAppearance {
  colors: ThemeColors;
  shape: ThemeShape;
  font: ThemeFont;
  mode: ResolvedMode;
  contrast: ResolvedContrast;
}

/** Shape and font come from the instance; personal colors replace the instance colors as one unit. */
export function resolveAppearance(
  instance: InstanceAppearance,
  personal: PersonalAppearance,
  system: SystemPreferences,
): ResolvedAppearance {
  return {
    colors: personal.colors ?? instance.colors,
    shape: instance.shape,
    font: instance.font,
    mode: personal.mode === 'system' ? (system.prefersDark ? 'dark' : 'light') : personal.mode,
    contrast:
      personal.contrast === 'system'
        ? system.prefersMoreContrast
          ? 'high'
          : 'standard'
        : personal.contrast,
  };
}
```

`packages/theme/src/vars.ts`:

```ts
import { MaterialDynamicColors, hexFromArgb } from '@material/material-color-utilities';
import type { CoreColorId, ThemeColors } from '@smart/contracts';
import type { ResolvedAppearance } from './resolve.js';
import { COLOR_ROLES, toCamel } from './roles.js';
import { PALETTE_OF, buildScheme, sourceArgb } from './scheme.js';
import { fontVars, shapeVars } from './shape-font.js';
import { statusVars } from './status.js';

type RoleGetter = { getArgb(scheme: unknown): number };

export function computeThemeVars(resolved: ResolvedAppearance): Record<string, string> {
  const scheme = buildScheme(resolved.colors, resolved.mode, resolved.contrast);
  const vars: Record<string, string> = {};
  for (const role of COLOR_ROLES) {
    const getter = (MaterialDynamicColors as unknown as Record<string, RoleGetter>)[toCamel(role)]!;
    vars[`--mat-sys-${role}`] = hexFromArgb(getter.getArgb(scheme));
  }
  vars['--mat-sys-neutral10'] = hexFromArgb(scheme.neutralPalette.tone(10));
  vars['--mat-sys-neutral-variant20'] = hexFromArgb(scheme.neutralVariantPalette.tone(20));
  return {
    ...vars,
    ...statusVars(sourceArgb(resolved.colors), resolved.mode, resolved.contrast),
    ...shapeVars(resolved.shape),
    ...fontVars(resolved.font),
  };
}

/** Key colors as shown in the theme editor: the override, or the color derived from the current source. */
export function deriveKeyColors(
  colors: ThemeColors,
): Record<CoreColorId, { hex: string; source: 'derived' | 'override' }> {
  const scheme = buildScheme(colors, 'light', 'standard');
  const result = {} as Record<CoreColorId, { hex: string; source: 'derived' | 'override' }>;
  for (const id of Object.keys(PALETTE_OF) as CoreColorId[]) {
    const override = colors.coreOverrides[id];
    result[id] = override
      ? { hex: override.toLowerCase(), source: 'override' }
      : { hex: hexFromArgb(scheme[PALETTE_OF[id]].keyColor.toInt()), source: 'derived' };
  }
  return result;
}
```

`packages/theme/src/contrast.ts`:

```ts
/** WCAG 2.x contrast ratio of two #rrggbb colors. */
export function contrastRatio(hexA: string, hexB: string): number {
  const [la, lb] = [luminance(hexA), luminance(hexB)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
```

`packages/theme/src/index.ts`:

```ts
export { contrastRatio } from './contrast.js';
export { resolveAppearance, type ResolvedAppearance, type SystemPreferences } from './resolve.js';
export { COLOR_ROLES } from './roles.js';
export { type ResolvedContrast, type ResolvedMode } from './scheme.js';
export { FONT_FAMILIES } from './shape-font.js';
export { STATUS_NAMES, type StatusName } from './status.js';
export { computeThemeVars, deriveKeyColors } from './vars.js';
```

- [ ] **Step 5: Tests laufen lassen – müssen bestehen**

Run: `pnpm --filter @smart/theme test`
Expected: PASS. Schlägt ein Fall der Kontrast-Matrix fehl, ist das ein echter Befund: zuerst die Status-Töne in `TONES` (Task 2, `status.ts`) für die betroffene Kombination anpassen; Material-Rollen selbst werden nicht verändert. Bleibt ein Material-Rollenpaar der Bibliothek unter der Schwelle, wird die Erwartung für genau diese Kombination im Test begründet gelockert und im Ledger als Ruling vermerkt.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint
git add packages/theme pnpm-lock.yaml
git commit -m "feat(ui): add theme engine computing Material and status color roles"
```

---

### Task 3: Build-Verdrahtung und Lizenz der Schriften

**Files:**

- Modify: `package.json` (Skripte), `apps/backend/Dockerfile`, `apps/frontend/Dockerfile`, `CLAUDE.md`
- Modify: `tools/lint-config/licenses/check-licenses.mjs`, `tools/lint-config/test/check-licenses.spec.mjs`

**Interfaces:**

- Produces: Root-Skript `packages:build` (baut `@smart/contracts` und `@smart/theme` in Abhängigkeitsreihenfolge); `prepare` nutzt es; Dockerfiles bauen alle Workspace-Abhängigkeiten generisch.

- [ ] **Step 1: Failing test – Schriftlizenz**

In `tools/lint-config/test/check-licenses.spec.mjs` in der Liste der erlaubten Ausdrücke `'OFL-1.1'` ergänzen.

Run: `pnpm --filter @smart/lint-config exec vitest run test/check-licenses.spec.mjs`
Expected: FAIL – `allows OFL-1.1`.

- [ ] **Step 2: Umsetzung**

In `tools/lint-config/licenses/check-licenses.mjs` die Menge `ALLOWED` um `'OFL-1.1'` ergänzen, mit Kommentar in der Zeile darüber: `// OFL-1.1: self-hosted web fonts, distributed alongside (not linked into) the AGPL code.`

Root-`package.json`:

- neues Skript `"packages:build": "pnpm --filter @smart/contracts --filter @smart/theme build"`
- `"contracts:build"` entfernen; `"prepare": "lefthook install && pnpm packages:build"`

`apps/backend/Dockerfile` und `apps/frontend/Dockerfile`: die Zeile `&& pnpm --filter @smart/contracts build \` ersetzen durch `&& pnpm --filter "@smart/backend^..." build \` bzw. `&& pnpm --filter "@smart/frontend^..." build \` (baut alle Workspace-Abhängigkeiten der App in Reihenfolge).

`CLAUDE.md`: `pnpm contracts:build` → `pnpm packages:build` (inkl. Hinweistext).

- [ ] **Step 3: Verifizieren**

```bash
pnpm --filter @smart/lint-config exec vitest run test/check-licenses.spec.mjs
pnpm install && pnpm packages:build && ls packages/theme/dist/index.js
grep -rn "contracts:build\|--filter @smart/contracts build" --include=*.json --include=*.md --include=*.yml --include=*.yaml --include=Dockerfile . | grep -v node_modules | grep -v docs/superpowers || echo "no stale references"
```

Expected: PASS; Datei existiert; `no stale references`.

- [ ] **Step 4: Commit**

```bash
pnpm format
git add package.json apps/backend/Dockerfile apps/frontend/Dockerfile CLAUDE.md tools/lint-config
git commit -m "chore(repo): build all workspace packages generically and allow OFL fonts"
```

---

### Task 4: Standard-CSS aus dem Instanz-Default erzeugen

**Files:**

- Create: `packages/theme/scripts/generate-default-css.mjs`, `packages/theme/src/default-css.ts`, `packages/theme/src/default-css.spec.ts`
- Create (generiert, committet): `apps/frontend/projects/ui/src/lib/tokens/default-theme.css` (Verzeichnis entsteht hier; Task 5 legt die Bibliothek daneben an)
- Modify: `packages/theme/src/index.ts`, `packages/theme/package.json`

**Interfaces:**

- Consumes: `computeThemeVars`, `resolveAppearance`, `DEFAULT_INSTANCE_APPEARANCE`.
- Produces: `renderDefaultThemeCss(instance: InstanceAppearance): string`; Skript `pnpm --filter @smart/theme generate:default-css` schreibt die CSS-Datei.

- [ ] **Step 1: Failing tests**

`packages/theme/src/default-css.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_INSTANCE_APPEARANCE } from '@smart/contracts';
import { describe, expect, it } from 'vitest';
import { computeThemeVars } from './vars.js';
import { renderDefaultThemeCss } from './default-css.js';

const committed = fileURLToPath(
  new URL('../../../apps/frontend/projects/ui/src/lib/tokens/default-theme.css', import.meta.url),
);

describe('renderDefaultThemeCss', () => {
  const css = renderDefaultThemeCss(DEFAULT_INSTANCE_APPEARANCE);
  const base = {
    colors: DEFAULT_INSTANCE_APPEARANCE.colors,
    shape: 'standard' as const,
    font: 'roboto-flex' as const,
  };

  it('starts with light values on :root', () => {
    const light = computeThemeVars({ ...base, mode: 'light', contrast: 'standard' });
    expect(css).toMatch(/^\/\* Generated by @smart\/theme/);
    expect(css).toContain(`:root {\n  color-scheme: light;\n`);
    expect(css).toContain(`  --mat-sys-surface: ${light['--mat-sys-surface']};`);
  });

  it('switches colors for dark and for more contrast', () => {
    const dark = computeThemeVars({ ...base, mode: 'dark', contrast: 'standard' });
    const darkHigh = computeThemeVars({ ...base, mode: 'dark', contrast: 'high' });
    expect(css).toContain('@media (prefers-color-scheme: dark) {');
    expect(css).toContain(`    --mat-sys-surface: ${dark['--mat-sys-surface']};`);
    expect(css).toContain('@media (prefers-color-scheme: dark) and (prefers-contrast: more) {');
    expect(css).toContain(
      `    --mat-sys-on-surface-variant: ${darkHigh['--mat-sys-on-surface-variant']};`,
    );
  });

  it('is committed and up to date (run: pnpm --filter @smart/theme generate:default-css)', () => {
    expect(readFileSync(committed, 'utf8')).toBe(css);
  });
});
```

Run: `pnpm --filter @smart/theme exec vitest run src/default-css.spec.ts`
Expected: FAIL – `Cannot find module './default-css.js'`.

- [ ] **Step 2: Umsetzung**

`packages/theme/src/default-css.ts`:

```ts
import type { InstanceAppearance } from '@smart/contracts';
import { resolveAppearance } from './resolve.js';
import type { ResolvedContrast, ResolvedMode } from './scheme.js';
import { computeThemeVars } from './vars.js';

/** Build-time theme: correct colors before any script runs. */
export function renderDefaultThemeCss(instance: InstanceAppearance): string {
  const vars = (mode: ResolvedMode, contrast: ResolvedContrast) =>
    computeThemeVars(
      resolveAppearance(
        instance,
        { mode, contrast },
        { prefersDark: false, prefersMoreContrast: false },
      ),
    );
  const block = (values: Record<string, string>, indent: string) =>
    Object.entries(values)
      .map(([name, value]) => `${indent}${name}: ${value};`)
      .join('\n');
  const isColor = (name: string) =>
    (name.startsWith('--mat-sys-') && !name.startsWith('--mat-sys-corner-')) ||
    name.startsWith('--smart-status-');
  const colorOnly = (values: Record<string, string>) =>
    Object.fromEntries(Object.entries(values).filter(([name]) => isColor(name)));

  return [
    '/* Generated by @smart/theme from the instance default – do not edit. */',
    '/* Regenerate: pnpm --filter @smart/theme generate:default-css */',
    `:root {\n  color-scheme: light;\n${block(vars('light', 'standard'), '  ')}\n}`,
    `@media (prefers-color-scheme: dark) {\n  :root {\n    color-scheme: dark;\n${block(colorOnly(vars('dark', 'standard')), '    ')}\n  }\n}`,
    `@media (prefers-contrast: more) {\n  :root {\n${block(colorOnly(vars('light', 'high')), '    ')}\n  }\n}`,
    `@media (prefers-color-scheme: dark) and (prefers-contrast: more) {\n  :root {\n${block(colorOnly(vars('dark', 'high')), '    ')}\n  }\n}`,
    '',
  ].join('\n');
}
```

In `packages/theme/src/index.ts` ergänzen: `export { renderDefaultThemeCss } from './default-css.js';`

`packages/theme/scripts/generate-default-css.mjs`:

```js
#!/usr/bin/env node
// Writes the build-time default theme for the web app from the instance default appearance.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_INSTANCE_APPEARANCE } from '@smart/contracts';
import { renderDefaultThemeCss } from '../dist/index.js';

const target = fileURLToPath(
  new URL('../../../apps/frontend/projects/ui/src/lib/tokens/default-theme.css', import.meta.url),
);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, renderDefaultThemeCss(DEFAULT_INSTANCE_APPEARANCE));
console.log(`wrote ${target}`);
```

`packages/theme/package.json`, `scripts` ergänzen: `"generate:default-css": "pnpm build && node scripts/generate-default-css.mjs"`.

- [ ] **Step 3: Erzeugen und Tests ausführen**

```bash
pnpm --filter @smart/theme generate:default-css
pnpm --filter @smart/theme test
grep -c "^  --mat-sys-" apps/frontend/projects/ui/src/lib/tokens/default-theme.css
```

Expected: `wrote …/default-theme.css`; PASS; mindestens 63 Zeilen (51 Farb- + 12 Ecken-Variablen) im `:root`-Block.

`apps/frontend/projects/ui/src/lib/tokens/default-theme.css` in `.prettierignore` aufnehmen (generierte Datei).

- [ ] **Step 4: Gegenprobe – veraltete Datei wird erkannt**

```bash
sed -i '' 's/--mat-sys-primary: #/--mat-sys-primary: #0/' apps/frontend/projects/ui/src/lib/tokens/default-theme.css
pnpm --filter @smart/theme exec vitest run src/default-css.spec.ts; echo "exit=$?"
pnpm --filter @smart/theme generate:default-css
```

Expected: `exit=1` (Test „is committed and up to date“ schlägt fehl); danach wieder erzeugt.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/theme apps/frontend/projects/ui/src/lib/tokens/default-theme.css .prettierignore
git commit -m "feat(ui): generate the build-time default theme CSS"
```

---

### Task 5: Bibliothek `@smart/ui` mit Angular Material, Schriften und Abstands-Tokens

**Files:**

- Create (generiert, angepasst): `apps/frontend/projects/ui/**`
- Create: `apps/frontend/projects/ui/src/lib/tokens/_material.scss`, `apps/frontend/projects/ui/src/lib/tokens/layout.css`, `apps/frontend/projects/ui/src/styles.scss`
- Modify: `apps/frontend/angular.json`, `apps/frontend/tsconfig.json`, `apps/frontend/package.json`, `apps/frontend/src/styles.scss`

**Interfaces:**

- Consumes: `apps/frontend/projects/ui/src/lib/tokens/default-theme.css` (Task 4).
- Produces: Import `@smart/ui` (Pfad-Alias auf `projects/ui/src/public-api.ts`); globale Styles der App = `projects/ui/src/styles.scss` (Material-Theme mit `var(--smart-font-family)`, Standard-CSS, Abstands-Tokens, Schriften, Material Symbols); Tokens `--smart-space-{xs,sm,md,lg,xl,2xl,3xl}` und `--smart-border-width`; Frontend-Skripte rufen Projekte explizit auf (`ng build frontend`, `ng test frontend`).

- [ ] **Step 1: Bibliothek erzeugen**

```bash
cd apps/frontend
pnpm exec ng generate library ui --prefix ui --skip-install
cd ../..
pnpm install
node -e "const a=require('./apps/frontend/angular.json');console.log(a.projects.ui.architect.test?.builder)"
```

Expected: `@angular/build:unit-test`. Bricht `ng generate` ab, weil `projects/ui/` durch Task 4 schon existiert: `src/lib/tokens/default-theme.css` in den Scratch-Ordner verschieben, generieren, zurücklegen und `pnpm --filter @smart/theme exec vitest run src/default-css.spec.ts` grün sehen (Ruling). Erzeugt die CLI ein anderes Test-Target (z. B. Karma), das Target durch `{ "builder": "@angular/build:unit-test" }` ersetzen und keine Karma-Pakete installieren (Ruling).

Danach anpassen:

- `apps/frontend/projects/ui/package.json`: `"name": "@smart/ui"`, `"license": "AGPL-3.0-only"`, `"private": true`.
- `apps/frontend/tsconfig.json` → `compilerOptions.paths`: generierten Eintrag ersetzen durch `"@smart/ui": ["./projects/ui/src/public-api.ts"]`. Die App bindet die Bibliothek aus dem Quellcode ein, kein separater Bibliotheks-Build.
- Generierte Beispielkomponente (`projects/ui/src/lib/ui.ts`, `ui.spec.ts`, ggf. `ui.html`/`ui.scss`) löschen; `projects/ui/src/public-api.ts`:
  ```ts
  // Public API of @smart/ui – the theme runtime follows in this stage, components in stage 3b.
  export {};
  ```
- `apps/frontend/package.json`, `scripts`:

  ```json
  "start": "ng serve frontend",
  "build": "ng build frontend",
  "test": "ng test frontend --watch=false",
  "typecheck": "tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.spec.json --noEmit && tsc -p projects/ui/tsconfig.lib.json --noEmit && tsc -p projects/ui/tsconfig.spec.json --noEmit"
  ```

  (Mit zwei Projekten im Workspace braucht die CLI den Projektnamen.)

- [ ] **Step 2: Abhängigkeiten**

```bash
pnpm --filter @smart/frontend add --save-exact @angular/material@22.2.2 @angular/cdk@22.2.2 @fontsource-variable/roboto-flex@5.3.0 @fontsource-variable/figtree@5.3.0 @fontsource-variable/atkinson-hyperlegible-next@5.3.0 material-symbols@0.48.0 "@smart/theme@workspace:*"
pnpm licenses:check
```

Expected: `licenses ok (…)` (Schriften sind OFL-1.1, seit Task 3 erlaubt).

- [ ] **Step 3: Tokens und globale Styles**

`apps/frontend/projects/ui/src/lib/tokens/layout.css`:

```css
/* Spacing and line tokens on a 4px grid. Fixed lengths are only allowed in tokens/. */
:root {
  --smart-space-xs: 4px;
  --smart-space-sm: 8px;
  --smart-space-md: 12px;
  --smart-space-lg: 16px;
  --smart-space-xl: 24px;
  --smart-space-2xl: 32px;
  --smart-space-3xl: 48px;
  --smart-border-width: 1px;
}
```

`apps/frontend/projects/ui/src/lib/tokens/_material.scss`:

```scss
@use '@angular/material' as mat;

// Material's system tokens; colors, corners and the font family are overridden at runtime by the
// generated default theme and ThemeService (--mat-sys-*, --smart-font-family).
@mixin core() {
  html {
    @include mat.theme(
      (
        color: (
          primary: mat.$cyan-palette,
          theme-type: color-scheme,
        ),
        typography: (
          plain-family: var(--smart-font-family),
          brand-family: var(--smart-font-family),
        ),
        density: 0,
      )
    );
  }
}
```

(`mat.theme` schreibt auf `html`; das generierte Standard-CSS auf `:root` hat höhere Spezifität und gewinnt, die Laufzeitwerte des `ThemeService` als Inline-Eigenschaften gewinnen über beides.)

`apps/frontend/projects/ui/src/styles.scss`:

```scss
// Font faces are only declared here; browsers download a face only when text uses it,
// so just the active font is loaded.
@use '@fontsource-variable/roboto-flex/index';
@use '@fontsource-variable/figtree/index';
@use '@fontsource-variable/atkinson-hyperlegible-next/index';
@use 'material-symbols/rounded';
@use './lib/tokens/material';
@use './lib/tokens/default-theme';
@use './lib/tokens/layout';

@include material.core();

body {
  margin: 0;
  background: var(--mat-sys-surface);
  color: var(--mat-sys-on-surface);
  font: var(--mat-sys-body-large);
}
```

`apps/frontend/src/styles.scss` vollständig ersetzen durch:

```scss
@use '../projects/ui/src/styles';
```

- [ ] **Step 4: Verifizieren**

```bash
pnpm --filter @smart/frontend build
CSS=$(ls apps/frontend/dist/frontend/browser/styles-*.css)
grep -c "var(--smart-font-family)" "$CSS"
grep -o "\-\-mat-sys-primary:" "$CSS" | wc -l
grep -c "\-\-smart-space-lg" "$CSS"
ls apps/frontend/dist/frontend/browser/media | grep -ciE "roboto|figtree|atkinson|material-symbols"
pnpm lint && pnpm --filter @smart/frontend typecheck && pnpm --filter @smart/frontend test
```

Expected: Build erfolgreich; `var(--smart-font-family)` ≥ 1 (Typografie nutzt die Laufzeitschrift); `--mat-sys-primary:` ≥ 2 (Material + generiertes Standard-CSS); `--smart-space-lg` ≥ 1; Schriftdateien liegen im Build (selbst gehostet, > 0); Lint, Typecheck und Tests grün.

Abweichungen und ihre Rulings:

- Löst Sass die Paketpfade (`@fontsource-variable/…/index`, `material-symbols/rounded`) nicht auf: diese vier Einträge aus `styles.scss` entfernen und stattdessen in `angular.json` → `projects.frontend.architect.build.options.styles` vor `src/styles.scss` als `node_modules/<paket>/index.css` bzw. `node_modules/material-symbols/rounded.css` eintragen.
- Scheitert `mat.theme` an `var(...)` als Schriftfamilie: `plain-family`/`brand-family: 'Roboto Flex Variable'` setzen und in `styles.scss` nach `@include material.core();` für alle 15 Stufen (display/headline/title/body/label × large/medium/small) `html { --mat-sys-<stufe>-font: var(--smart-font-family); }` setzen. Diese Zeilen gehören in eine Token-Datei `tokens/_typography.scss`, da Stylelint `--`-Eigenschaften außerhalb `tokens/` verbietet.

- [ ] **Step 5: Commit**

```bash
pnpm format
git add apps/frontend pnpm-lock.yaml
git commit -m "feat(ui): add @smart/ui library with Material theme, tokens and self-hosted fonts"
```

---

### Task 6: `ThemeService`, Speicher und `theme-boot.js`

**Files:**

- Create: `apps/frontend/projects/ui/src/lib/theme/{appearance-store.ts, appearance-store.spec.ts, media-queries.ts, instance-appearance.token.ts, apply-theme.ts, theme.service.ts, theme.service.spec.ts, provide-theme.ts}`
- Create: `apps/frontend/public/theme-boot.js`, `apps/frontend/src/app/theme-boot.spec.ts`
- Modify: `apps/frontend/projects/ui/src/public-api.ts`, `apps/frontend/src/app/app.config.ts`, `apps/frontend/src/index.html`, `apps/frontend/package.json`, `apps/frontend/tsconfig.spec.json`, `tests/e2e/specs/stack-smoke.spec.ts`

**Interfaces:**

- Consumes: `resolveAppearance`, `computeThemeVars`, `ResolvedAppearance`, `ResolvedMode` (Task 2); Schemas und Defaults (Task 1).
- Produces (`@smart/ui`):
  - `ThemeService` mit `instance: WritableSignal<InstanceAppearance>`, `personal: WritableSignal<PersonalAppearance>`, `resolved: Signal<ResolvedAppearance>`, `setPersonal(value: PersonalAppearance): void`, `resetPersonalColors(): void`, `setInstance(value: InstanceAppearance): void`
  - `applyThemeVars(root: HTMLElement, vars: Record<string, string>, mode: ResolvedMode): void`
  - Token `APPEARANCE_STORE` (`AppearanceStore` mit `loadInstance()`, `loadPersonal()`, `saveInstance()`, `savePersonal()`, `saveBootCache(cache: BootCache)`), Klasse `LocalStorageAppearanceStore`
  - Token `MEDIA_QUERIES` (`MediaQueries` mit `matches(query): boolean`, `listen(query, cb): () => void`)
  - Token `INSTANCE_APPEARANCE`; `provideTheme(options?: { instance?: InstanceAppearance }): EnvironmentProviders`
  - Storage-Schlüssel `smart.appearance.instance`, `smart.appearance.personal`, `smart.theme.boot`; `BootCache = { mode: ThemeMode; light: Record<string, string>; dark: Record<string, string> }`

- [ ] **Step 1: Test-Setup für Specs mit Node-Zugriff**

```bash
pnpm --filter @smart/frontend add -D --save-exact @types/node@24.19.2
```

`apps/frontend/tsconfig.spec.json` → `"types": ["vitest/globals", "node"]` (nur Specs; App-Code bleibt ohne Node-Typen). `apps/frontend/package.json` → `"test": "ng test frontend --watch=false && ng test ui --watch=false"`.

- [ ] **Step 2: Failing tests – Store**

`apps/frontend/projects/ui/src/lib/theme/appearance-store.spec.ts`:

```ts
import { DEFAULT_INSTANCE_APPEARANCE } from '@smart/contracts';
import { LocalStorageAppearanceStore } from './appearance-store';

describe('LocalStorageAppearanceStore', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips personal and instance appearance', () => {
    const store = new LocalStorageAppearanceStore();
    store.savePersonal({ mode: 'dark', contrast: 'high' });
    store.saveInstance(DEFAULT_INSTANCE_APPEARANCE);
    expect(store.loadPersonal()).toEqual({ mode: 'dark', contrast: 'high' });
    expect(store.loadInstance()).toEqual(DEFAULT_INSTANCE_APPEARANCE);
  });

  it.each(['not json', '{"mode":"neon","contrast":"system"}', 'null'])(
    'returns null for unusable personal data %j',
    (raw) => {
      localStorage.setItem('smart.appearance.personal', raw);
      expect(new LocalStorageAppearanceStore().loadPersonal()).toBeNull();
    },
  );

  it('survives storage that throws', () => {
    const store = new LocalStorageAppearanceStore({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(store.loadPersonal()).toBeNull();
    expect(() => store.savePersonal({ mode: 'light', contrast: 'system' })).not.toThrow();
  });
});
```

- [ ] **Step 3: Failing tests – ThemeService**

`apps/frontend/projects/ui/src/lib/theme/theme.service.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import {
  DEFAULT_INSTANCE_APPEARANCE,
  type InstanceAppearance,
  type PersonalAppearance,
} from '@smart/contracts';
import { computeThemeVars } from '@smart/theme';
import { APPEARANCE_STORE, type AppearanceStore, type BootCache } from './appearance-store';
import { MEDIA_QUERIES, type MediaQueries } from './media-queries';
import { provideTheme } from './provide-theme';
import { ThemeService } from './theme.service';

class FakeMedia implements MediaQueries {
  state: Record<string, boolean> = {};
  private listeners: Record<string, ((matches: boolean) => void)[]> = {};
  matches = (query: string) => this.state[query] ?? false;
  listen = (query: string, callback: (matches: boolean) => void) => {
    (this.listeners[query] ??= []).push(callback);
    return () => undefined;
  };
  emit(query: string, value: boolean) {
    this.state[query] = value;
    this.listeners[query]?.forEach((callback) => callback(value));
  }
}

class MemoryStore implements AppearanceStore {
  personal: PersonalAppearance | null = null;
  instance: InstanceAppearance | null = null;
  boot: BootCache | null = null;
  loadPersonal = () => this.personal;
  loadInstance = () => this.instance;
  savePersonal = (value: PersonalAppearance) => {
    this.personal = value;
  };
  saveInstance = (value: InstanceAppearance) => {
    this.instance = value;
  };
  saveBootCache = (value: BootCache) => {
    this.boot = value;
  };
}

function setup(store = new MemoryStore(), media = new FakeMedia()) {
  TestBed.configureTestingModule({
    providers: [
      provideTheme(),
      { provide: APPEARANCE_STORE, useValue: store },
      { provide: MEDIA_QUERIES, useValue: media },
    ],
  });
  const service = TestBed.inject(ThemeService);
  TestBed.tick();
  return { service, store, media };
}
const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name);
const base = {
  colors: DEFAULT_INSTANCE_APPEARANCE.colors,
  shape: 'standard' as const,
  font: 'roboto-flex' as const,
};
const plum = { seed: '#6e4c7e', variant: 'vibrant' as const, colorMatch: false, coreOverrides: {} };

describe('ThemeService', () => {
  afterEach(() => document.documentElement.removeAttribute('style'));

  it('applies the default theme to the document root', () => {
    setup();
    expect(rootVar('--mat-sys-primary')).toBe(
      computeThemeVars({ ...base, mode: 'light', contrast: 'standard' })['--mat-sys-primary'],
    );
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('follows the system switching to dark while mode is system', () => {
    const { media } = setup();
    media.emit('(prefers-color-scheme: dark)', true);
    TestBed.tick();
    expect(rootVar('--mat-sys-surface')).toBe(
      computeThemeVars({ ...base, mode: 'dark', contrast: 'standard' })['--mat-sys-surface'],
    );
  });

  it('uses high contrast when the system asks for more contrast', () => {
    const { media } = setup();
    media.emit('(prefers-contrast: more)', true);
    TestBed.tick();
    expect(rootVar('--mat-sys-on-surface-variant')).toBe(
      computeThemeVars({ ...base, mode: 'light', contrast: 'high' })[
        '--mat-sys-on-surface-variant'
      ],
    );
  });

  it('keeps an explicit mode when the system changes', () => {
    const { service, media } = setup();
    service.setPersonal({ mode: 'light', contrast: 'system' });
    media.emit('(prefers-color-scheme: dark)', true);
    TestBed.tick();
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('persists personal changes and the boot cache for both modes', () => {
    const { service, store } = setup();
    service.setPersonal({ mode: 'dark', contrast: 'system', colors: plum });
    TestBed.tick();
    expect(store.personal?.mode).toBe('dark');
    expect(store.boot?.mode).toBe('dark');
    expect(store.boot?.light['--mat-sys-primary']).not.toBe(store.boot?.dark['--mat-sys-primary']);
  });

  it('resets personal colors to the instance default', () => {
    const { service } = setup();
    service.setPersonal({ mode: 'system', contrast: 'system', colors: plum });
    service.resetPersonalColors();
    TestBed.tick();
    expect(service.resolved().colors).toEqual(DEFAULT_INSTANCE_APPEARANCE.colors);
  });

  it('starts from stored settings', () => {
    const store = new MemoryStore();
    store.personal = { mode: 'dark', contrast: 'medium' };
    const { service } = setup(store);
    expect([service.resolved().mode, service.resolved().contrast]).toEqual(['dark', 'medium']);
  });
});
```

- [ ] **Step 4: Failing test – theme-boot.js**

`apps/frontend/src/app/theme-boot.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const script = readFileSync(join(process.cwd(), 'public/theme-boot.js'), 'utf8');
const run = () => new Function(script)() as void;
const root = () => document.documentElement.style;

describe('theme-boot.js', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
  });

  it('applies the cached dark theme before Angular starts', () => {
    localStorage.setItem(
      'smart.theme.boot',
      JSON.stringify({
        mode: 'dark',
        light: { '--mat-sys-surface': '#ffffff' },
        dark: { '--mat-sys-surface': '#101415' },
      }),
    );
    run();
    expect(root().getPropertyValue('--mat-sys-surface')).toBe('#101415');
    expect(root().colorScheme).toBe('dark');
  });

  it('does nothing without a cache', () => {
    run();
    expect(root().getPropertyValue('--mat-sys-surface')).toBe('');
  });

  it.each(['not json', '{"mode":"dark"}', '{"mode":"dark","light":{},"dark":{"color":"red"}}'])(
    'ignores unusable cache %j',
    (raw) => {
      localStorage.setItem('smart.theme.boot', raw);
      expect(run).not.toThrow();
      expect(root().getPropertyValue('color')).toBe('');
    },
  );
});
```

Run: `pnpm --filter @smart/frontend test`
Expected: FAIL – `theme-boot.spec.ts`: `ENOENT … public/theme-boot.js`; `ng test ui`: fehlende Module `./appearance-store`, `./theme.service`.

- [ ] **Step 5: Implementierung**

`apps/frontend/projects/ui/src/lib/theme/appearance-store.ts`:

```ts
import { InjectionToken } from '@angular/core';
import {
  instanceAppearanceSchema,
  personalAppearanceSchema,
  type InstanceAppearance,
  type PersonalAppearance,
  type ThemeMode,
} from '@smart/contracts';

export interface BootCache {
  mode: ThemeMode;
  light: Record<string, string>;
  dark: Record<string, string>;
}

export interface AppearanceStore {
  loadInstance(): InstanceAppearance | null;
  loadPersonal(): PersonalAppearance | null;
  saveInstance(value: InstanceAppearance): void;
  savePersonal(value: PersonalAppearance): void;
  saveBootCache(value: BootCache): void;
}

const KEYS = {
  instance: 'smart.appearance.instance',
  personal: 'smart.appearance.personal',
  boot: 'smart.theme.boot',
} as const;
type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Stage 3 persistence in the browser; replaced by the API in stage 4. Never throws. */
export class LocalStorageAppearanceStore implements AppearanceStore {
  constructor(private readonly storage: KeyValueStorage | undefined = globalThis.localStorage) {}

  loadInstance(): InstanceAppearance | null {
    return this.read(KEYS.instance, (raw) => instanceAppearanceSchema.parse(raw));
  }
  loadPersonal(): PersonalAppearance | null {
    return this.read(KEYS.personal, (raw) => personalAppearanceSchema.parse(raw));
  }
  saveInstance(value: InstanceAppearance): void {
    this.write(KEYS.instance, value);
  }
  savePersonal(value: PersonalAppearance): void {
    this.write(KEYS.personal, value);
  }
  saveBootCache(value: BootCache): void {
    this.write(KEYS.boot, value);
  }

  private read<T>(key: string, parse: (raw: unknown) => T): T | null {
    try {
      const raw = this.storage?.getItem(key);
      return raw ? parse(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }
  private write(key: string, value: unknown): void {
    try {
      this.storage?.setItem(key, JSON.stringify(value));
    } catch {
      // Storage blocked or full: the theme still works for this session.
    }
  }
}

export const APPEARANCE_STORE = new InjectionToken<AppearanceStore>('APPEARANCE_STORE', {
  providedIn: 'root',
  factory: () => new LocalStorageAppearanceStore(),
});
```

`apps/frontend/projects/ui/src/lib/theme/media-queries.ts`:

```ts
import { InjectionToken } from '@angular/core';

export interface MediaQueries {
  matches(query: string): boolean;
  listen(query: string, callback: (matches: boolean) => void): () => void;
}

class BrowserMediaQueries implements MediaQueries {
  matches(query: string): boolean {
    return globalThis.matchMedia?.(query).matches ?? false;
  }
  listen(query: string, callback: (matches: boolean) => void): () => void {
    const list = globalThis.matchMedia?.(query);
    if (!list) return () => undefined;
    const handler = (event: MediaQueryListEvent) => callback(event.matches);
    list.addEventListener('change', handler);
    return () => list.removeEventListener('change', handler);
  }
}

export const MEDIA_QUERIES = new InjectionToken<MediaQueries>('MEDIA_QUERIES', {
  providedIn: 'root',
  factory: () => new BrowserMediaQueries(),
});
```

`apps/frontend/projects/ui/src/lib/theme/instance-appearance.token.ts`:

```ts
import { InjectionToken } from '@angular/core';
import { DEFAULT_INSTANCE_APPEARANCE, type InstanceAppearance } from '@smart/contracts';

/** Instance default appearance; stage 3c feeds it from the runtime config.json. */
export const INSTANCE_APPEARANCE = new InjectionToken<InstanceAppearance>('INSTANCE_APPEARANCE', {
  providedIn: 'root',
  factory: () => DEFAULT_INSTANCE_APPEARANCE,
});
```

`apps/frontend/projects/ui/src/lib/theme/apply-theme.ts`:

```ts
import type { ResolvedMode } from '@smart/theme';

/** Writes theme variables via CSSOM, which the strict CSP allows (unlike inline style tags). */
export function applyThemeVars(
  root: HTMLElement,
  vars: Record<string, string>,
  mode: ResolvedMode,
): void {
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  root.style.colorScheme = mode;
}
```

`apps/frontend/projects/ui/src/lib/theme/theme.service.ts`:

```ts
import { DOCUMENT, DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  DEFAULT_PERSONAL_APPEARANCE,
  instanceAppearanceSchema,
  personalAppearanceSchema,
  type InstanceAppearance,
  type PersonalAppearance,
} from '@smart/contracts';
import { computeThemeVars, resolveAppearance } from '@smart/theme';
import { APPEARANCE_STORE } from './appearance-store';
import { applyThemeVars } from './apply-theme';
import { INSTANCE_APPEARANCE } from './instance-appearance.token';
import { MEDIA_QUERIES } from './media-queries';

const DARK = '(prefers-color-scheme: dark)';
const MORE_CONTRAST = '(prefers-contrast: more)';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly store = inject(APPEARANCE_STORE);
  private readonly media = inject(MEDIA_QUERIES);

  readonly instance = signal<InstanceAppearance>(
    this.store.loadInstance() ?? inject(INSTANCE_APPEARANCE),
  );
  readonly personal = signal<PersonalAppearance>(
    this.store.loadPersonal() ?? DEFAULT_PERSONAL_APPEARANCE,
  );
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
    inject(DestroyRef).onDestroy(() => {
      stopDark();
      stopContrast();
    });
    effect(() => this.apply());
  }

  setPersonal(value: PersonalAppearance): void {
    const parsed = personalAppearanceSchema.parse(value);
    this.personal.set(parsed);
    this.store.savePersonal(parsed);
  }

  resetPersonalColors(): void {
    const { mode, contrast } = this.personal();
    this.setPersonal({ mode, contrast });
  }

  setInstance(value: InstanceAppearance): void {
    const parsed = instanceAppearanceSchema.parse(value);
    this.instance.set(parsed);
    this.store.saveInstance(parsed);
  }

  private apply(): void {
    const resolved = this.resolved();
    const light = computeThemeVars({ ...resolved, mode: 'light' });
    const dark = computeThemeVars({ ...resolved, mode: 'dark' });
    applyThemeVars(
      this.document.documentElement,
      resolved.mode === 'dark' ? dark : light,
      resolved.mode,
    );
    // Both modes are cached so theme-boot.js can follow the system setting without a flash.
    this.store.saveBootCache({ mode: this.personal().mode, light, dark });
  }
}
```

`apps/frontend/projects/ui/src/lib/theme/provide-theme.ts`:

```ts
import {
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import type { InstanceAppearance } from '@smart/contracts';
import { INSTANCE_APPEARANCE } from './instance-appearance.token';
import { ThemeService } from './theme.service';

/** Starts the ThemeService with the app so the theme applies on boot. */
export function provideTheme(
  options: { instance?: InstanceAppearance } = {},
): EnvironmentProviders {
  return makeEnvironmentProviders([
    ...(options.instance ? [{ provide: INSTANCE_APPEARANCE, useValue: options.instance }] : []),
    provideEnvironmentInitializer(() => {
      inject(ThemeService);
    }),
  ]);
}
```

`apps/frontend/projects/ui/src/public-api.ts`:

```ts
// Public API of @smart/ui.
export {
  APPEARANCE_STORE,
  LocalStorageAppearanceStore,
  type AppearanceStore,
  type BootCache,
} from './lib/theme/appearance-store';
export { applyThemeVars } from './lib/theme/apply-theme';
export { INSTANCE_APPEARANCE } from './lib/theme/instance-appearance.token';
export { MEDIA_QUERIES, type MediaQueries } from './lib/theme/media-queries';
export { provideTheme } from './lib/theme/provide-theme';
export { ThemeService } from './lib/theme/theme.service';
```

`apps/frontend/public/theme-boot.js`:

```js
// Applies the user's last theme before Angular starts (no flash). External file: the CSP forbids inline scripts.
(function () {
  try {
    var cache = JSON.parse(localStorage.getItem('smart.theme.boot') || 'null');
    if (!cache || typeof cache.light !== 'object' || typeof cache.dark !== 'object') return;
    var dark =
      cache.mode === 'dark' ||
      (cache.mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var vars = dark ? cache.dark : cache.light;
    var style = document.documentElement.style;
    for (var name in vars) {
      if (name.indexOf('--') === 0 && typeof vars[name] === 'string')
        style.setProperty(name, vars[name]);
    }
    style.colorScheme = dark ? 'dark' : 'light';
  } catch (error) {
    // Storage unavailable or corrupt: the build-time default theme applies.
  }
})();
```

`apps/frontend/src/index.html`: im `<head>` direkt nach `<meta name="viewport" …>` einfügen: `<script src="theme-boot.js"></script>` (blockierend, damit es vor dem ersten Rendern greift; die CSP erlaubt `script-src 'self'`).

`apps/frontend/src/app/app.config.ts`:

```ts
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTheme } from '@smart/ui';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), provideRouter(routes), provideTheme()],
};
```

- [ ] **Step 6: Tests laufen lassen – müssen bestehen**

Run: `pnpm --filter @smart/frontend test && pnpm --filter @smart/frontend typecheck && pnpm lint`
Expected: PASS – App: bisherige Tests + theme-boot 5; `ui`: Store 5, ThemeService 7. Lint greift hier erstmals auf `projects/ui` (Selector-Präfix `ui`, nur `styleUrl`).

- [ ] **Step 7: Browser-Tests gegen Aufblitzen und überflüssige Schriften**

In `tests/e2e/specs/stack-smoke.spec.ts` ergänzen:

```ts
test('a stored dark theme applies even before the app bundle runs', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem(
      'smart.theme.boot',
      JSON.stringify({
        mode: 'dark',
        light: { '--mat-sys-surface': '#ffffff' },
        dark: { '--mat-sys-surface': '#101415' },
      }),
    ),
  );
  await page.route(/main-[A-Z0-9]+\.js$/, (route) => route.abort());
  await page.reload();
  const surface = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mat-sys-surface').trim(),
  );
  expect(surface).toBe('#101415');
});

test('the generated default theme colors the page without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  const primary = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mat-sys-primary').trim(),
  );
  expect(primary).toMatch(/^#[0-9a-f]{6}$/);
  await context.close();
});

test('only the active font family is downloaded', async ({ page }) => {
  const fonts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'font') fonts.push(request.url());
  });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  expect(fonts.filter((url) => /figtree|atkinson/i.test(url))).toEqual([]);
});
```

(Playwright wertet `page.evaluate` in einer eigenen Welt aus; das funktioniert auch bei deaktiviertem Seiten-JavaScript. Schlägt das im zweiten Test dennoch fehl, wird stattdessen das ausgelieferte `styles-*.css` per `request.get` geladen und auf `--mat-sys-primary:` geprüft – Ruling.)

Run: `sh infra/compose/test/stack-test.sh`
Expected: `OK: stack test passed`, inklusive der drei neuen Tests.

- [ ] **Step 8: Commit**

```bash
pnpm format
git add apps/frontend tests/e2e pnpm-lock.yaml
git commit -m "feat(ui): add ThemeService with browser persistence and flash-free boot script"
```

---

### Task 7: Storybook mit Farbrollen-Übersicht und Prüfungen

**Files:**

- Create: `apps/frontend/.storybook/{main.ts, preview.ts, test-runner.ts, tsconfig.json}`
- Create: `apps/frontend/projects/ui/src/lib/theme/{color-roles.story-component.ts, color-roles.story-component.html, color-roles.story-component.scss, color-roles.stories.ts}`
- Modify: `apps/frontend/angular.json`, `apps/frontend/package.json`, `.github/workflows/ci.yml`, `.gitignore`, `.prettierignore`

**Interfaces:**

- Consumes: `applyThemeVars` (Task 6), `computeThemeVars`, `COLOR_ROLES`, `STATUS_NAMES`, `ResolvedAppearance` (Task 2), `THEME_VARIANTS`, `DEFAULT_INSTANCE_APPEARANCE` (Task 1), Tokens `--smart-space-*`, `--smart-border-width` (Task 5).
- Produces: Frontend-Skripte `storybook`, `build-storybook`, `test-storybook:ci`; Storybook-Globals `seed`, `variant`, `mode`, `contrast`, `shape`, `font`; Ausgabe `apps/frontend/storybook-static`; CI-Job `storybook`.

- [ ] **Step 1: Installation**

```bash
pnpm --filter @smart/frontend add -D --save-exact storybook@10.6.1 @storybook/angular@10.6.1 @storybook/addon-a11y@10.6.1 @storybook/addon-docs@10.6.1 @angular-devkit/build-angular@22.2.2 @storybook/test-runner@0.26.0 axe-playwright@2.2.2 http-server@14.1.1 wait-on@9.1.0 concurrently@10.0.5
pnpm licenses:check
```

Expected: `licenses ok (…)`. Meldet pnpm Build-Skripte, nur gezielt per `pnpm approve-builds <paket>` freigeben, nachdem geprüft ist, was das Skript tut (Ruling mit Begründung). Verlangt `@storybook/angular` `zone.js`, `zone.js` als Dev-Abhängigkeit in der zu Angular 22.2 passenden Version ergänzen (Ruling).

- [ ] **Step 2: Failing check – Story ohne Storybook**

`apps/frontend/projects/ui/src/lib/theme/color-roles.stories.ts`:

```ts
import type { Meta, StoryObj } from '@storybook/angular';
import { computeThemeVars, type ResolvedAppearance } from '@smart/theme';
import { expect } from 'storybook/test';
import { ColorRolesStoryComponent } from './color-roles.story-component';

const meta: Meta<ColorRolesStoryComponent> = {
  title: 'Grundlagen/Farbrollen',
  component: ColorRolesStoryComponent,
};
export default meta;

export const Alle: StoryObj<ColorRolesStoryComponent> = {
  play: async ({ globals, canvas }) => {
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
    const actual = getComputedStyle(document.documentElement)
      .getPropertyValue('--mat-sys-primary')
      .trim();
    await expect(actual).toBe(expected['--mat-sys-primary']);
    await expect(canvas.getAllByRole('listitem')).toHaveLength(49 + 5);
  },
};
```

Run: `pnpm --filter @smart/frontend exec tsc -p projects/ui/tsconfig.lib.json --noEmit`
Expected: FAIL – `Cannot find module './color-roles.story-component'`.

- [ ] **Step 3: Story-Komponente**

`apps/frontend/projects/ui/src/lib/theme/color-roles.story-component.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { COLOR_ROLES, STATUS_NAMES } from '@smart/theme';

/** Storybook-only overview of every color role; not part of the public API. */
@Component({
  selector: 'ui-color-roles',
  templateUrl: './color-roles.story-component.html',
  styleUrl: './color-roles.story-component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColorRolesStoryComponent {
  readonly roles = COLOR_ROLES;
  readonly statuses = STATUS_NAMES;
}
```

`apps/frontend/projects/ui/src/lib/theme/color-roles.story-component.html`:

```html
<h2>Farbrollen</h2>
<ul class="grid">
  @for (role of roles; track role) {
  <li class="swatch" [style.background]="'var(--mat-sys-' + role + ')'">
    <span class="label">{{ role }}</span>
  </li>
  }
</ul>
<h2>Statusfarben</h2>
<ul class="grid">
  @for (name of statuses; track name) {
  <li
    class="swatch"
    [style.background]="'var(--smart-status-' + name + '-container)'"
    [style.color]="'var(--smart-status-on-' + name + '-container)'"
  >
    {{ name }}
  </li>
  }
</ul>
```

(Storybook-Texte bleiben deutsch und ohne Übersetzungsschlüssel; die Übersetzungspflicht aus Spec 7 gilt für App-Oberflächen ab 3c.)

`apps/frontend/projects/ui/src/lib/theme/color-roles.story-component.scss`:

```scss
:host {
  display: block;
  padding: var(--smart-space-lg);
  background: var(--mat-sys-surface);
  color: var(--mat-sys-on-surface);
  font: var(--mat-sys-body-medium);
}

h2 {
  font: var(--mat-sys-title-medium);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(calc(var(--smart-space-3xl) * 3), 1fr));
  gap: var(--smart-space-sm);
  margin: 0;
  padding: 0;
  list-style: none;
}

.swatch {
  min-height: var(--smart-space-3xl);
  padding: var(--smart-space-sm);
  border: var(--smart-border-width) solid var(--mat-sys-outline-variant);
  border-radius: var(--mat-sys-corner-medium);
}

.label {
  padding: 0 var(--smart-space-xs);
  border-radius: var(--mat-sys-corner-extra-small);
  background: var(--mat-sys-surface);
  color: var(--mat-sys-on-surface);
  font: var(--mat-sys-label-small);
}
```

- [ ] **Step 4: Storybook-Konfiguration**

`apps/frontend/.storybook/main.ts`:

```ts
import type { StorybookConfig } from '@storybook/angular';

const config: StorybookConfig = {
  stories: ['../projects/ui/src/**/*.stories.ts'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
  framework: { name: '@storybook/angular', options: {} },
  staticDirs: ['../public'],
};
export default config;
```

`apps/frontend/.storybook/preview.ts`:

```ts
import { DEFAULT_INSTANCE_APPEARANCE, THEME_VARIANTS } from '@smart/contracts';
import { computeThemeVars, type ResolvedAppearance } from '@smart/theme';
import { applyThemeVars } from '@smart/ui';
import type { Decorator, Preview } from '@storybook/angular';

/** Applies the toolbar selection with the same engine the app uses; no ThemeService needed. */
const withTheme: Decorator = (story, { globals }) => {
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
  applyThemeVars(document.documentElement, computeThemeVars(resolved), resolved.mode);
  return story();
};

const toolbar = (title: string, items: readonly (string | { value: string; title: string })[]) => ({
  description: title,
  toolbar: { title, items: [...items], dynamicTitle: true },
});

const preview: Preview = {
  decorators: [withTheme],
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
    mode: toolbar('Modus', ['light', 'dark']),
    contrast: toolbar('Kontrast', ['standard', 'medium', 'high']),
    shape: toolbar('Formen', ['kantig', 'standard', 'weich']),
    font: toolbar('Schrift', ['roboto-flex', 'figtree', 'atkinson']),
  },
  initialGlobals: {
    seed: DEFAULT_INSTANCE_APPEARANCE.colors.seed,
    variant: DEFAULT_INSTANCE_APPEARANCE.colors.variant,
    mode: 'light',
    contrast: 'standard',
    shape: DEFAULT_INSTANCE_APPEARANCE.shape,
    font: DEFAULT_INSTANCE_APPEARANCE.font,
  },
};
export default preview;
```

`apps/frontend/.storybook/test-runner.ts`:

```ts
import type { TestRunnerConfig } from '@storybook/test-runner';
import { checkA11y, injectAxe } from 'axe-playwright';

const config: TestRunnerConfig = {
  async preVisit(page) {
    await injectAxe(page);
  },
  async postVisit(page) {
    await checkA11y(page, '#storybook-root', {
      detailedReport: true,
      detailedReportOptions: { html: true },
    });
  },
};
export default config;
```

`apps/frontend/.storybook/tsconfig.json`:

```json
{
  "extends": "../tsconfig.app.json",
  "compilerOptions": {
    "types": ["node"]
  },
  "include": ["./*.ts", "../projects/ui/src/**/*.ts"],
  "exclude": ["../projects/ui/src/**/*.spec.ts"]
}
```

`apps/frontend/angular.json` → `projects.frontend.architect` ergänzen:

```json
"storybook": {
  "builder": "@storybook/angular:start-storybook",
  "options": {
    "configDir": ".storybook",
    "browserTarget": "frontend:build",
    "tsConfig": ".storybook/tsconfig.json",
    "styles": ["src/styles.scss"],
    "compodoc": false,
    "port": 6006
  }
},
"build-storybook": {
  "builder": "@storybook/angular:build-storybook",
  "options": {
    "configDir": ".storybook",
    "browserTarget": "frontend:build",
    "tsConfig": ".storybook/tsconfig.json",
    "styles": ["src/styles.scss"],
    "compodoc": false,
    "outputDir": "storybook-static"
  }
}
```

`apps/frontend/package.json`, `scripts` ergänzen und `typecheck` erweitern:

```json
"storybook": "ng run frontend:storybook",
"build-storybook": "ng run frontend:build-storybook",
"test-storybook:ci": "concurrently -k -s first -n SB,TEST \"http-server storybook-static -p 6006 -s\" \"wait-on tcp:127.0.0.1:6006 && test-storybook --url http://127.0.0.1:6006\"",
"typecheck": "tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.spec.json --noEmit && tsc -p projects/ui/tsconfig.lib.json --noEmit && tsc -p projects/ui/tsconfig.spec.json --noEmit && tsc -p .storybook/tsconfig.json --noEmit"
```

`projects/ui/tsconfig.lib.json` → `exclude` um `"**/*.stories.ts"` ergänzen (Stories gehören nicht in die Bibliothek; geprüft werden sie über `.storybook/tsconfig.json`).

`.gitignore` und `.prettierignore`: `storybook-static/` ergänzen.

- [ ] **Step 5: Lokal prüfen**

```bash
pnpm --filter @smart/frontend typecheck
pnpm --filter @smart/frontend build-storybook
pnpm --filter @smart/frontend exec playwright install chromium
pnpm --filter @smart/frontend test-storybook:ci
pnpm lint
```

Expected: Typecheck grün; Storybook baut; der Test-Runner meldet `Grundlagen/Farbrollen › Alle` als bestanden (Play-Funktion und axe ohne Verstöße); Lint und Stylelint grün.

Meldet axe einen Kontrastverstoß, ist das ein echter Befund in der Story-Komponente (z. B. Beschriftung auf einer Rolle ohne passende On-Farbe) und wird dort behoben, nicht durch Abschalten der Regel.

- [ ] **Step 6: CI-Job `storybook`**

In `.github/workflows/ci.yml` unter `jobs:` ergänzen:

```yaml
storybook:
  name: storybook
  runs-on: ubuntu-24.04
  env:
    LEFTHOOK: '0'
  steps:
    - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      with:
        persist-credentials: false
    - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
    - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
      with:
        node-version-file: .nvmrc
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @smart/frontend exec playwright install --with-deps chromium
    - run: pnpm --filter @smart/frontend build-storybook
    - run: pnpm --filter @smart/frontend test-storybook:ci
```

(Gleiche Pins wie die übrigen Jobs in `ci.yml`.)

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color`
Expected: keine Ausgabe.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add apps/frontend .github/workflows/ci.yml .gitignore .prettierignore pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(ui): add Storybook with color role overview, a11y and interaction checks"
```

---

### Task 8: Storybook auf GitHub Pages veröffentlichen

Diese Task wirkt nach außen (Pages-Aktivierung, Ruleset). Vor Step 3 bei Till nachfragen.

**Files:**

- Create: `.github/workflows/storybook-pages.yml`
- Modify: `infra/github/ruleset-main.json`, `README.md`

**Interfaces:**

- Consumes: Skript `build-storybook`.
- Produces: Storybook unter `https://tkosiol.github.io/smart-home/`; Pflicht-Check `storybook`.

- [ ] **Step 1: Workflow**

`.github/workflows/storybook-pages.yml`:

```yaml
name: Storybook

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: storybook-pages
  cancel-in-progress: true

jobs:
  build:
    name: build
    runs-on: ubuntu-24.04
    env:
      LEFTHOOK: '0'
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @smart/frontend build-storybook
      - uses: actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d # v6.0.0
      - uses: actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0
        with:
          path: apps/frontend/storybook-static

  deploy:
    name: deploy
    needs: build
    runs-on: ubuntu-24.04
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346 # v5.0.1
```

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color`
Expected: keine Ausgabe.

- [ ] **Step 2: Ruleset und README**

`infra/github/ruleset-main.json`: Pflicht-Check `{ "context": "storybook", "integration_id": 15368 }` ergänzen. `README.md`, Abschnitt „Struktur“ ergänzen: `| Storybook | https://tkosiol.github.io/smart-home/ – alle UI-Bausteine in allen Themes |`.

```bash
pnpm format
git add .github/workflows/storybook-pages.yml infra/github/ruleset-main.json README.md
git commit -m "ci: publish Storybook to GitHub Pages"
```

- [ ] **Step 3: Pages aktivieren (nach Tills Freigabe)**

```bash
gh api -X POST repos/tkosiol/smart-home/pages -f build_type=workflow --jq '.html_url'
RULESET_ID=$(gh api repos/tkosiol/smart-home/rulesets --jq '.[] | select(.name == "main") | .id')
gh api -X PUT "repos/tkosiol/smart-home/rulesets/$RULESET_ID" --input infra/github/ruleset-main.json --jq '[.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context]'
```

Expected: `https://tkosiol.github.io/smart-home/`; Checkliste enthält `storybook`.

- [ ] **Step 4: PR, Merge (nach Freigabe), Veröffentlichung prüfen**

```bash
git push -u origin feat/etappe-3a-theme
gh pr create --base main --title "feat(ui): theme engine, @smart/ui foundation and published Storybook (stage 3a)" --body "Implements docs/superpowers/plans/2026-10-11-etappe-3a-theme-fundament.md and adds the stage 3 spec."
gh pr checks --watch
```

Nach dem Merge:

```bash
gh run watch "$(gh run list --workflow Storybook --limit 1 --json databaseId --jq '.[0].databaseId')"
curl -fsS -o /dev/null -w '%{http_code}\n' https://tkosiol.github.io/smart-home/
```

Expected: Workflow grün; `200`.

---

## Ergebnis und Übertrag

Umgesetzt subagent-gestützt (je Task Umsetzung und Review, am Ende Gesamt-Review des Branches). Dieser Abschnitt hält fest, wo die Umsetzung vom Plan abweicht und was die Pläne 3b und 3c übernehmen müssen.

### Abweichungen vom Plan (Entscheidungen)

- **Error-Override:** folgt wie alle Kernfarben der Farbtreue-Regel (Spec 4.4); ohne Farbtreue liefert er nur den Farbton. Der Plan-Code hatte ihn immer mit eigener Buntheit übernommen.
- **Farbtreue an:** Primärrollen folgen der Fidelity-Logik unabhängig von der Variante, auch bei Monochrom (Spec 4.4: „Rollen-Töne nach Fidelity-Logik“).
- **Statusfarben:** „Trocken“ ist Bernsteingelb `#c99a00` (vorher `#c77800`), die Harmonisierung zur Quelle ist auf 8° begrenzt (statt bis 15°), „offline“ ist ein reines Grau, dunkle Töne 80/82/85. Grund: „Trocken“ und „Warnung“ waren in manchen Themes kaum unterscheidbar; ein Test sichert jetzt den Mindestabstand (CIELAB ΔE ≥ 20 für Statusfarben, ≥ 12 für Container) über Grundfarben, Modi und Kontraststufen.
- **Bundle-Budget:** `@smart/contracts` nutzt `zod/mini` (`import * as z from 'zod/mini'`), das klassische `zod` blähte das initiale Bundle auf 724 KB. Jetzt 292 KB; das Budget `initial` bricht ab 500 kB mit Fehler ab (Spec 10).
- **Speicher:** `LocalStorageAppearanceStore` greift erst innerhalb von `try` auf `localStorage` zu, damit die App auch bei gesperrtem Browser-Speicher startet (Plan-Code las ihn im Konstruktor).
- **`theme-boot.js`:** eigene nginx-Location mit `Cache-Control: no-cache` (die Datei hat keinen Hash und wäre sonst ein Jahr lang `immutable` gecacht). Lint: Browser-Globals für `apps/frontend/public/**/*.js` über einen eigenen, getesteten Block.
- **Sass:** Die Schrift-Importe brauchen eigene Namensräume (`as roboto-flex` usw.).
- **Bibliotheksgerüst:** Das von der CLI erzeugte ng-packagr-Ziel bleibt; die App nutzt `@smart/ui` weiter direkt aus dem Quellcode.
- **Storybook:**
  - Zweite Story mit dunklem Theme und hohem Kontrast, damit der Interaktionstest die Werkzeugleiste wirklich prüft.
  - axe prüft WCAG 2.0–2.2 A/AA einschließlich `target-size`.
  - `jest-runtime` ist auf 30.4.2 festgelegt (Grund und Ausstiegskriterium in `pnpm-workspace.yaml`), weil `@storybook/test-runner` 0.26 mit 30.5 nicht startet.
  - Lizenzausnahme für `union@0.5.0` (Abhängigkeit von `http-server`; Manifest ohne Lizenzangabe, Lizenzdatei MIT), eng auf Name und Version, mit Test.
- **Spec 4.3:** Der persönliche Kontrast kennt zusätzlich `system` (Standard, bei `prefers-contrast: more` Hoch).

### Übertrag in Plan 3b

- Material-Symbols-Font (5,4 MB) vor `ui-icon` verkleinern (Subset) oder ersetzen.
- Gehashte Schriftdateien (`woff2`) in die `immutable`-Regel der nginx-Konfiguration aufnehmen.
- Story-Listen (Varianten, Modi, Formen, Schriften) und Rollenanzahl aus Contracts und Theme-Konstanten ableiten statt hart zu kodieren; Storybook-Telemetrie abschalten; `http-server` lokal nur an `127.0.0.1` binden.
- Ablösung des auslaufenden `@storybook/test-runner` beobachten; danach den `jest-runtime`-Override entfernen.
- Playwright im Frontend ausdrücklich als Abhängigkeit führen (bisher nur über Peer-Abhängigkeiten vorhanden).

### Übertrag in Plan 3c

- **Vorrang des Instanz-Themes ausdrücklich festlegen** (Spec 4.5 Punkt 4). Vorschlag: im Browser gespeicherte Instanz nur bei eingeschaltetem `features.instanceAppearanceEditor`, sonst `config.json`, sonst Build-Default. Heute gewinnt eine gespeicherte Instanz immer.
- Boot-Cache mit Versionskennung (Instanz-Hash, aufgelöster Kontrast) versehen, damit ein geänderter Instanz-Default oder ein umgeschalteter Systemkontrast nicht kurz alt aufblitzt.
- Storybook-Werkzeugleiste auf `ThemeService` umstellen (Spec 9) und Sprache ergänzen.
- Theme-Editor: Variantenwahl bei aktiver Farbtreue sperren oder erklären; graue Overrides ohne Farbtreue als unbunt behandeln.
- `ThemeService.instance`/`personal` nur lesend nach außen geben (`asReadonly()`); ungültige persönliche Farben getrennt verwerfen, Modus und Kontrast behalten; Synchronisation zwischen Tabs (`storage`-Ereignis) prüfen.
- `theme-boot.js` in die Service-Worker-Assetgruppe ohne Hash aufnehmen.
- E2E „nur aktive Schrift geladen“ verschärfen, sobald die App Text rendert (Roboto Flex muss angefragt werden).
- Optisch prüfen: „Trocken“ wirkt im Hellmodus (`#715d00`) eher senf- als bernsteinfarben.

### Bewusst zurückgestellt (klein)

- `CLAUDE.md` nennt beim Neubau noch nur „Contracts“, obwohl auch das Theme-Paket gebaut wird.
- Zusätzliche Ablehntests (Form, Schrift, `#rgb`, `#rrggbbaa`).
- Test der Blockreihenfolge im Standard-CSS.
- Generator ohne Prüfung auf vorhandenes `dist`.
- `applyThemeVars` entfernt veraltete Variablen nicht.
- Node-Globals in `public/*.js` noch erlaubt.
- Tests für `setInstance`-Persistenz und für die Drehrichtung der Harmonisierung.
- `cancel-in-progress` im Pages-Workflow.
- `storybook-static/` in `.dockerignore`.
- Spec 4.4 könnte „offline: neutrales Grau“ nennen.
