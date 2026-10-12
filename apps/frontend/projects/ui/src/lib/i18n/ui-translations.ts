import type { Translation } from '@jsverse/transloco';
import type { Language } from '@smart/contracts';

const LOADERS: Record<Language, () => Promise<Translation>> = {
  de: () => import('../../i18n/de.json').then((module) => module.default),
  en: () => import('../../i18n/en.json').then((module) => module.default),
};

/** The library's own texts (keys `ui.*`); the app and Storybook merge them into their root translation. */
export function loadUiTranslation(language: Language): Promise<Translation> {
  return LOADERS[language]();
}
