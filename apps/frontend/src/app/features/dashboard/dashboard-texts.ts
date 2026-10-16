import { provideTranslocoScope } from '@jsverse/transloco';

/** The texts of the overview, loaded with the page and with the customise sheet. */
export function provideDashboardTexts() {
  return provideTranslocoScope({
    scope: 'dashboard',
    loader: {
      de: () => import('./i18n/de.json').then((m) => m.default),
      en: () => import('./i18n/en.json').then((m) => m.default),
    },
  });
}
