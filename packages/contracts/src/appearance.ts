import * as z from 'zod/mini';

const hexColor = z.string().check(z.regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb'));

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
export const THEME_SHAPES = ['kantig', 'standard', 'weich'] as const;
export const THEME_FONTS = ['roboto-flex', 'figtree', 'atkinson'] as const;
export const THEME_MODES = ['system', 'light', 'dark'] as const;
export const THEME_CONTRASTS = ['system', 'standard', 'medium', 'high'] as const;

export const themeColorsSchema = z.object({
  seed: hexColor,
  variant: z.enum(THEME_VARIANTS),
  colorMatch: z.boolean(),
  coreOverrides: z._default(z.partialRecord(z.enum(CORE_COLOR_IDS), hexColor), {}),
});

export const instanceAppearanceSchema = z.object({
  colors: themeColorsSchema,
  shape: z.enum(THEME_SHAPES),
  font: z.enum(THEME_FONTS),
});

export const personalAppearanceSchema = z.object({
  colors: z.optional(themeColorsSchema),
  mode: z.enum(THEME_MODES),
  contrast: z.enum(THEME_CONTRASTS),
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
