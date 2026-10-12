import { provideTranslocoScope } from '@jsverse/transloco';
import type { Routes } from '@angular/router';
import { DevicesPage } from './devices-page';

export const devicesRoutes: Routes = [
  {
    path: '',
    component: DevicesPage,
    providers: [
      provideTranslocoScope({
        scope: 'devices',
        loader: {
          de: () => import('./i18n/de.json').then((m) => m.default),
          en: () => import('./i18n/en.json').then((m) => m.default),
        },
      }),
    ],
  },
];
