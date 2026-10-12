import { describe, expect, it } from 'vitest';
import { DEFAULT_LANGUAGE, LANGUAGES, languageSchema, matchLanguage } from './language.js';

describe('languages', () => {
  it('supports German and English with German as default', () => {
    expect(LANGUAGES).toEqual(['de', 'en']);
    expect(DEFAULT_LANGUAGE).toBe('de');
    expect(languageSchema.safeParse('en').success).toBe(true);
    expect(languageSchema.safeParse('fr').success).toBe(false);
  });

  it.each([
    [['en-US', 'de'], 'en'],
    [['de-AT'], 'de'],
    [['EN-gb'], 'en'],
    [['fr-FR', 'en-GB'], 'en'],
    [['fr'], 'de'],
    [[], 'de'],
    [[''], 'de'],
  ])('matches the browser languages %j to %s', (preferred, expected) => {
    expect(matchLanguage(preferred)).toBe(expected);
  });
});
