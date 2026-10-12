import {
  inject,
  isDevMode,
  makeEnvironmentProviders,
  provideAppInitializer,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { TranslocoService, provideTransloco } from '@jsverse/transloco';
import { DEFAULT_LANGUAGE, LANGUAGES } from '@smart/contracts';
import { firstValueFrom } from 'rxjs';
import { AppTranslationLoader } from './app-translation-loader';
import { LanguageService } from './language.service';

/**
 * Transloco for the app; the LanguageService starts with the app and picks the language, which is
 * loaded before the first render.
 */
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
    // The first render already shows the active language instead of keys or a flash of German.
    provideAppInitializer(() => {
      const language = inject(LanguageService).language();
      // No value when the injector is destroyed meanwhile (tests): that is not an error.
      return firstValueFrom(inject(TranslocoService).load(language), {
        defaultValue: undefined,
      }).then(() => undefined);
    }),
  ]);
}
