import * as z from 'zod/mini';

export const LANGUAGES = ['de', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'de';
export const languageSchema = z.enum(LANGUAGES);

/** First supported language among the browser's preferences (by primary subtag), else German. */
export function matchLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split('-')[0];
    const match = LANGUAGES.find((language) => language === primary);
    if (match) return match;
  }
  return DEFAULT_LANGUAGE;
}
