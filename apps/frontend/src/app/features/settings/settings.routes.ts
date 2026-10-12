import { inject } from '@angular/core';
import { Router, type CanMatchFn, type Routes } from '@angular/router';
import { provideTranslocoScope } from '@jsverse/transloco';
import { RUNTIME_CONFIG } from '../../core/config';

/** The installation appearance is only reachable while the hoster enabled its editor (also by URL). */
const instanceEditorEnabled: CanMatchFn = () =>
  inject(RUNTIME_CONFIG).features.instanceAppearanceEditor ||
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
        loadComponent: () => import('./appearance-page').then((m) => m.AppearancePage),
      },
      {
        path: 'installation',
        canMatch: [instanceEditorEnabled],
        loadComponent: () => import('./installation-page').then((m) => m.InstallationPage),
      },
    ],
  },
];
