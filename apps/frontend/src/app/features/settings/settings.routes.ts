import { inject } from '@angular/core';
import { Router, type CanMatchFn, type Routes } from '@angular/router';
import { provideTranslocoScope } from '@jsverse/transloco';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import { AuthService } from '../../core/auth';

/**
 * The installation appearance is for the platform admin only (also by URL); Task 7 moves this
 * guard to core/household. The shell's `signedIn` guard has settled the user before it runs.
 */
const platformAdmin: CanMatchFn = () =>
  inject(AuthService).me()?.isPlatformAdmin === true ||
  inject(Router).parseUrl('/mehr/einstellungen');

// Pages load lazily (loadComponent): the app config imports this folder's index at startup for
// provideSettingsFeature(), and must not pull the pages into the initial bundle with it.
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
