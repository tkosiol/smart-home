import { provideTranslocoScope } from '@jsverse/transloco';

/** The texts of the devices pages, loaded when something of this feature is shown. */
export function provideDevicesTexts() {
  return provideTranslocoScope({
    scope: 'devices',
    loader: {
      de: () => import('./i18n/de.json').then((m) => m.default),
      en: () => import('./i18n/en.json').then((m) => m.default),
    },
  });
}
