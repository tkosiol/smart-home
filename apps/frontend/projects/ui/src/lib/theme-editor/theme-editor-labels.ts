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
