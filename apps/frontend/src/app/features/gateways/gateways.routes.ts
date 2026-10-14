import type { Routes } from '@angular/router';
import { provideTranslocoScope } from '@jsverse/transloco';

// The page loads lazily (loadComponent): the app config imports this folder's index at startup for
// provideGatewaysFeature(), and must not pull the page into the initial bundle with it.

/** `/mehr/gateways`. */
export const gatewaysRoutes: Routes = [
  {
    path: '',
    providers: [
      provideTranslocoScope({
        scope: 'gateways',
        loader: {
          de: () => import('./i18n/de.json').then((m) => m.default),
          en: () => import('./i18n/en.json').then((m) => m.default),
        },
      }),
    ],
    loadComponent: () => import('./gateways-page').then((m) => m.GatewaysPage),
  },
];
