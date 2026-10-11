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
