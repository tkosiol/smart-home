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

  it('applies the colorMatch rule to the error override too', () => {
    const grey = { ...petrol, coreOverrides: { error: '#9e9e9e' } };
    const softened = computeThemeVars(resolved({ colors: grey }))['--mat-sys-error']!;
    const matched = computeThemeVars(resolved({ colors: { ...grey, colorMatch: true } }))[
      '--mat-sys-error'
    ]!;
    // Without colorMatch only the hue is taken; chroma comes from the variant's error palette
    // (capped by the sRGB gamut at this hue, ~35 at tone 40) instead of the grey's ~2.
    expect(chroma(softened)).toBeGreaterThan(25);
    expect(chroma(matched)).toBeLessThan(10);
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
