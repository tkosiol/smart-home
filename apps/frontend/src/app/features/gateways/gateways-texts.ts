import { provideTranslocoScope } from '@jsverse/transloco';

/** The texts of the gateways, loaded when something of this feature is shown. */
export function provideGatewaysTexts() {
  return provideTranslocoScope({
    scope: 'gateways',
    loader: {
      de: () => import('./i18n/de.json').then((m) => m.default),
      en: () => import('./i18n/en.json').then((m) => m.default),
    },
  });
}
