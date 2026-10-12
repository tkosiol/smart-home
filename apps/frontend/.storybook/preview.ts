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
