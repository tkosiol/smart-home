import { importProvidersFrom, type EnvironmentProviders } from '@angular/core';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { LANGUAGES, type Language } from '@smart/contracts';
import de from '../../i18n/de.json';
import en from '../../i18n/en.json';

/** Transloco with the library's real texts, preloaded so templates render translated at once. */
export function provideUiTranslocoTesting(language: Language = 'de'): EnvironmentProviders {
  return importProvidersFrom(
    TranslocoTestingModule.forRoot({
      langs: { de, en },
      translocoConfig: { availableLangs: [...LANGUAGES], defaultLang: language },
      preloadLangs: true,
    }),
  );
}
