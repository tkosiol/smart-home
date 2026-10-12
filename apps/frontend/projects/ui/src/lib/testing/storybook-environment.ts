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
