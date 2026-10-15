import { provideTranslocoScope } from '@jsverse/transloco';

/** The texts of the page "Alle Hinweise", loaded with its route. */
export function provideAttentionTexts() {
  return provideTranslocoScope({
    scope: 'attention',
    loader: {
      de: () => import('./i18n/de.json').then((m) => m.default),
      en: () => import('./i18n/en.json').then((m) => m.default),
    },
  });
}
