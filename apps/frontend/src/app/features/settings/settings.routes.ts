import { provideTranslocoScope } from '@jsverse/transloco';
import type { Routes } from '@angular/router';
import { SettingsPage } from './settings-page';

export const settingsRoutes: Routes = [
  {
    path: '',
    component: SettingsPage,
    providers: [
      provideTranslocoScope({
        scope: 'settings',
        loader: {
          de: () => import('./i18n/de.json').then((m) => m.default),
          en: () => import('./i18n/en.json').then((m) => m.default),
        },
      }),
    ],
  },
];
