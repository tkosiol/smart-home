import { provideTranslocoScope } from '@jsverse/transloco';
import type { Routes } from '@angular/router';
import { DashboardPage } from './dashboard-page';

export const dashboardRoutes: Routes = [
  {
    path: '',
    component: DashboardPage,
    providers: [
      provideTranslocoScope({
        scope: 'dashboard',
        loader: {
          de: () => import('./i18n/de.json').then((m) => m.default),
          en: () => import('./i18n/en.json').then((m) => m.default),
        },
      }),
    ],
  },
];
