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
