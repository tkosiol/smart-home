import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INSTANCE_APPEARANCE,
  DEFAULT_PERSONAL_APPEARANCE,
  THEME_CONTRASTS,
  THEME_FONTS,
  THEME_MODES,
  THEME_SHAPES,
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
