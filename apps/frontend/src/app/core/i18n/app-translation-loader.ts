import { Injectable } from '@angular/core';
import type { Translation, TranslocoLoader } from '@jsverse/transloco';
import { DEFAULT_LANGUAGE, languageSchema, type Language } from '@smart/contracts';
import { loadUiTranslation } from '@smart/ui/shell';

const APP: Record<Language, () => Promise<Translation>> = {
  de: () => import('../../../i18n/de.json').then((module) => module.default),
  en: () => import('../../../i18n/en.json').then((module) => module.default),
};

/** Root translation = app texts + library texts (`ui.*`), each lazily loaded per language. */
@Injectable({ providedIn: 'root' })
export class AppTranslationLoader implements TranslocoLoader {
  async getTranslation(lang: string): Promise<Translation> {
    const parsed = languageSchema.safeParse(lang);
    const language = parsed.success ? parsed.data : DEFAULT_LANGUAGE;
    const [app, ui] = await Promise.all([APP[language](), loadUiTranslation(language)]);
    return { ...app, ...ui };
  }
}
