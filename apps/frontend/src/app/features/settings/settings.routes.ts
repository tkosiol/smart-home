import type { Routes } from '@angular/router';
import { provideTranslocoScope } from '@jsverse/transloco';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import { platformAdmin } from '../../core/household';

// Reached through the lazy hop in this folder's index, so neither these routes nor their texts
// belong to the initial bundle (#101).
export const settingsRoutes: Routes = [
  {
    path: '',
    providers: [
      provideTranslocoScope({
        scope: 'settings',
        loader: {
          de: () => import('./i18n/de.json').then((m) => m.default),
          en: () => import('./i18n/en.json').then((m) => m.default),
        },
      }),
    ],
    children: [
      {
        path: '',
        loadComponent: () => import('./settings-page').then((m) => m.SettingsPage),
      },
      {
        path: 'darstellung',
        title: marker('app.title.appearance'),
        loadComponent: () => import('./appearance-page').then((m) => m.AppearancePage),
      },
      {
        path: 'installation',
        title: marker('app.title.installation'),
        canMatch: [platformAdmin],
        loadComponent: () => import('./installation-page').then((m) => m.InstallationPage),
      },
    ],
  },
];
