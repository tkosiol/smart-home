import {
  ApplicationRef,
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
import { firstValueFrom } from 'rxjs';
import type { Decorator } from '@storybook/angular';
import { loadUiTranslation } from '../i18n/ui-translations';
import { UiFormatContext } from '../time/format-context';
import { APPEARANCE_STORE } from '../theme/appearance-store';
import { MemoryAppearanceStore } from '../theme/memory-appearance-store';
import { provideTheme } from '../theme/provide-theme';
import { THEME_ENGINE_LOADER, loadThemeEngine } from '../theme/theme-engine';
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

let translationsReady: Promise<unknown> = Promise.resolve();

/**
 * Resolves once the toolbar's language and the theme engine are loaded and rendered. Transloco renders empty strings
 * until the lazy translation arrives, so a play function that inspects text, layout or sizes must
 * await this first, or it checks an untranslated DOM.
 */
export const waitForTranslations = (): Promise<unknown> => translationsReady;

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

/** Started when the preview loads, so a story's theme is there as soon as it renders. */
const themeEngine = loadThemeEngine();

/** The app's theme and language machinery for stories, driven by the toolbar instead of storage. */
export function provideStorybookEnvironment(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideTheme(),
    { provide: THEME_ENGINE_LOADER, useValue: () => themeEngine },
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
      const formatContext = inject(UiFormatContext);
      const appRef = inject(ApplicationRef);
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
        formatContext.locale.set(globals.locale);
        translationsReady = Promise.all([
          firstValueFrom(transloco.load(globals.locale)),
          theme.ready,
        ]).then(() => appRef.whenStable());
        html.lang = globals.locale;
      });
    }),
  ]);
}
