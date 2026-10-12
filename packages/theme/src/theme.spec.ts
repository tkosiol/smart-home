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
  type ResolvedContrast,
  type ResolvedMode,
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

/** CIELAB (D65) of a #rrggbb color. */
function lab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const deltaE = (hexA: string, hexB: string) => {
  const [a, b] = [lab(hexA), lab(hexB)];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};
const labChroma = (hex: string) => Math.hypot(lab(hex)[1], lab(hex)[2]);

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
    const modes = ['light', 'dark'] as const;
    const contrasts = ['standard', 'medium', 'high'] as const;
    const textPairs = [
      ['on-surface', 'surface'],
      ['on-surface-variant', 'surface'],
      ['inverse-on-surface', 'inverse-surface'],
      ...(['primary', 'secondary', 'tertiary', 'error'] as const).flatMap((color) => [
        [`on-${color}`, color],
        [`on-${color}-container`, `${color}-container`],
      ]),
    ];

    const expectReadable = (
      colors: ThemeColors,
      mode: ResolvedMode,
      contrast: ResolvedContrast,
    ) => {
      const vars = computeThemeVars(resolved({ colors, mode, contrast }));
      const minText = contrast === 'high' ? 7 : 4.5;
      for (const [text, background] of textPairs) {
        expect(
          contrastRatio(vars[`--mat-sys-${text}`]!, vars[`--mat-sys-${background}`]!),
          `${text} on ${background}`,
        ).toBeGreaterThanOrEqual(minText);
      }
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
    };

    const seeds = ['#00687a', '#ffff00', '#101010', '#ff0000', '#8a5a00'];
    const seedCases = THEME_VARIANTS.flatMap((variant) =>
      seeds.flatMap((seed) =>
        modes.flatMap((mode) => contrasts.map((contrast) => ({ variant, seed, mode, contrast }))),
      ),
    );
    it.each(seedCases)('$variant $seed $mode $contrast', ({ variant, seed, mode, contrast }) => {
      expectReadable({ seed, variant, colorMatch: false, coreOverrides: {} }, mode, contrast);
    });

    const overrides = [
      { primary: '#6f9d2f', error: '#e8604c' },
      { primary: '#ffff00', error: '#9e9e9e' },
      { primary: '#101010', error: '#7b1fa2' },
    ];
    const overrideCases = [true, false].flatMap((colorMatch) =>
      THEME_VARIANTS.flatMap((variant) =>
        overrides.flatMap((coreOverrides) =>
          modes.flatMap((mode) =>
            contrasts.map((contrast) => ({ colorMatch, variant, coreOverrides, mode, contrast })),
          ),
        ),
      ),
    );
    it.each(overrideCases)(
      'colorMatch $colorMatch $variant $coreOverrides.primary/$coreOverrides.error $mode $contrast',
      ({ colorMatch, variant, coreOverrides, mode, contrast }) => {
        expectReadable({ seed: petrol.seed, variant, colorMatch, coreOverrides }, mode, contrast);
      },
    );
  });

  describe('keeps status colors distinguishable', () => {
    // CIE76 distance: ~2.3 is a just noticeable difference, above ~10 colors read as clearly different.
    // Status colors (indicators on the surface) must read as different hues at a glance: >= 20.
    // Containers sit at very light/dark tones where sRGB allows little chroma; they always carry an
    // icon and a label as well (WCAG 1.4.1), so >= 12 (still clearly different side by side) suffices.
    const MIN_COLOR_DELTA_E = 20;
    const MIN_CONTAINER_DELTA_E = 12;
    const seeds = ['#00687a', '#3e5f90', '#c77800', '#8a5a00', '#ffff00', '#101010', '#ff0000'];
    const cases = seeds.flatMap((seed) =>
      (['light', 'dark'] as const).flatMap((mode) =>
        (['standard', 'medium', 'high'] as const).map((contrast) => ({ seed, mode, contrast })),
      ),
    );
    const pairs = STATUS_NAMES.flatMap((a, i) => STATUS_NAMES.slice(i + 1).map((b) => [a, b]));

    it.each(cases)('$seed $mode $contrast', ({ seed, mode, contrast }) => {
      const vars = computeThemeVars(
        resolved({
          colors: { seed, variant: 'tonalSpot', colorMatch: false, coreOverrides: {} },
          mode,
          contrast,
        }),
      );
      for (const [a, b] of pairs) {
        expect(
          deltaE(vars[`--smart-status-${a}`]!, vars[`--smart-status-${b}`]!),
          `${a}/${b}`,
        ).toBeGreaterThanOrEqual(MIN_COLOR_DELTA_E);
        expect(
          deltaE(vars[`--smart-status-${a}-container`]!, vars[`--smart-status-${b}-container`]!),
          `${a}/${b} container`,
        ).toBeGreaterThanOrEqual(MIN_CONTAINER_DELTA_E);
      }
    });

    it('keeps offline a neutral grey that differs from the others by chroma', () => {
      for (const seed of seeds) {
        const vars = computeThemeVars(
          resolved({
            colors: { seed, variant: 'tonalSpot', colorMatch: false, coreOverrides: {} },
          }),
        );
        expect(labChroma(vars['--smart-status-offline']!), seed).toBeLessThan(2);
      }
    });
  });

  describe('uses the error roles for warnings', () => {
    // Red, orange and amber collapse into similar dark browns at the tones white text needs, so a
    // separate orange cannot stay apart from both error and dry. Warnings share the error roles and
    // are told apart from errors by icon and label.
    const cases = [
      { seed: '#00687a', coreOverrides: {} },
      { seed: '#ff0000', coreOverrides: {} },
      { seed: '#00687a', coreOverrides: { error: '#7b1fa2' } },
    ].flatMap((colors) =>
      (['light', 'dark'] as const).flatMap((mode) =>
        (['standard', 'high'] as const).map((contrast) => ({ ...colors, mode, contrast })),
      ),
    );
    it.each(cases)(
      '$seed $coreOverrides $mode $contrast',
      ({ seed, coreOverrides, mode, contrast }) => {
        const vars = computeThemeVars(
          resolved({
            colors: { seed, variant: 'tonalSpot', colorMatch: false, coreOverrides },
            mode,
            contrast,
          }),
        );
        expect(vars['--smart-status-warning']).toBe(vars['--mat-sys-error']);
        expect(vars['--smart-status-on-warning']).toBe(vars['--mat-sys-on-error']);
        expect(vars['--smart-status-warning-container']).toBe(vars['--mat-sys-error-container']);
        expect(vars['--smart-status-on-warning-container']).toBe(
          vars['--mat-sys-on-error-container'],
        );
      },
    );
  });

  it('harmonizes status colors towards the source by at most 8 degrees', () => {
    const seedHue = hue(petrol.seed);
    const vars = computeThemeVars(resolved());
    for (const [name, source] of [
      ['ok', '#2e7d32'],
      ['wet', '#1565c0'],
      ['dry', '#c18500'],
    ] as const) {
      const shifted = hue(vars[`--smart-status-${name}`]!);
      // The cap is 8 degrees; tone mapping adds up to ~2 degrees of HCT rounding.
      expect(hueDistance(shifted, hue(source)), name).toBeLessThanOrEqual(10);
      // Rotation direction: the result is closer to the source hue than the unharmonized color.
      expect(hueDistance(shifted, seedHue), name).toBeLessThan(hueDistance(hue(source), seedHue));
    }
  });

  it('applies an error override', () => {
    const colors = { ...petrol, coreOverrides: { error: '#7b1fa2' } };
    const errorHue = hue(computeThemeVars(resolved({ colors }))['--mat-sys-error']!);
    expect(hueDistance(errorHue, hue('#7b1fa2'))).toBeLessThan(10);
  });

  it('applies the colorMatch rule to the error override too', () => {
    const muted = { ...petrol, coreOverrides: { error: '#9a8686' } };
    const softened = computeThemeVars(resolved({ colors: muted }))['--mat-sys-error']!;
    const matched = computeThemeVars(resolved({ colors: { ...muted, colorMatch: true } }))[
      '--mat-sys-error'
    ]!;
    // Without colorMatch only the hue is taken; chroma comes from the variant's error palette
    // (capped by the sRGB gamut at this hue, ~35 at tone 40) instead of the muted color's ~8.
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
    expect(chromaOf(secondaryWith('#7a7d80'))).toBeLessThan(6);
  });

  it('still takes only the hue of a colorful override', () => {
    expect(chromaOf(secondaryWith('#3e5f90'))).toBeGreaterThan(12);
  });
});
