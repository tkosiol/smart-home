import {
  inject,
  isDevMode,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { provideTransloco } from '@jsverse/transloco';
import { DEFAULT_LANGUAGE, LANGUAGES } from '@smart/contracts';
import { AppTranslationLoader } from './app-translation-loader';
import { LanguageService } from './language.service';

/** Transloco for the app; the LanguageService starts with the app and picks the language. */
export function provideI18n(): EnvironmentProviders {
  return makeEnvironmentProviders([
    ...provideTransloco({
      config: {
        availableLangs: [...LANGUAGES],
        defaultLang: DEFAULT_LANGUAGE,
        fallbackLang: DEFAULT_LANGUAGE,
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
        missingHandler: { useFallbackTranslation: true, logMissingKey: isDevMode() },
      },
      loader: AppTranslationLoader,
    }),
    provideEnvironmentInitializer(() => {
      inject(LanguageService);
    }),
  ]);
}
