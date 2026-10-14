import type { Routes } from '@angular/router';
import { provideTranslocoScope } from '@jsverse/transloco';
import { SignInPage } from './sign-in-page';

export const authRoutes: Routes = [
  {
    path: '',
    component: SignInPage,
    providers: [
      provideTranslocoScope({
        scope: 'auth',
        loader: {
          de: () => import('./i18n/de.json').then((m) => m.default),
          en: () => import('./i18n/en.json').then((m) => m.default),
        },
      }),
    ],
  },
];
