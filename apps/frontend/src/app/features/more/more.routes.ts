import { provideTranslocoScope } from '@jsverse/transloco';
import type { Routes } from '@angular/router';
import { MorePage } from './more-page';

export const moreRoutes: Routes = [
  {
    path: '',
    component: MorePage,
    providers: [
      provideTranslocoScope({
        scope: 'more',
        loader: {
          de: () => import('./i18n/de.json').then((m) => m.default),
          en: () => import('./i18n/en.json').then((m) => m.default),
        },
      }),
    ],
  },
];
