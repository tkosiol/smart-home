import { provideTranslocoScope } from '@jsverse/transloco';
import type { Routes } from '@angular/router';
import { RoomsPage } from './rooms-page';

export const roomsRoutes: Routes = [
  {
    path: '',
    component: RoomsPage,
    providers: [
      provideTranslocoScope({
        scope: 'rooms',
        loader: {
          de: () => import('./i18n/de.json').then((m) => m.default),
          en: () => import('./i18n/en.json').then((m) => m.default),
        },
      }),
    ],
  },
];
