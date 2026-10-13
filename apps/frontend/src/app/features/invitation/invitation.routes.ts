import { inject } from '@angular/core';
import type { Routes } from '@angular/router';
import { provideTranslocoScope } from '@jsverse/transloco';
import { InvitationToken } from './invitation-token';

/**
 * `/einladung/:token` is the link of the invitation e-mail. The token is taken out of it right
 * away and the address becomes `/einladung`, so it stays in neither the history, bookmarks nor
 * later Referer headers (the redirect happens before the router commits the URL). The page reads
 * the token from `InvitationToken`; a visit to `/einladung` without one shows "invalid".
 */
export const invitationRoutes: Routes = [
  {
    path: ':token',
    redirectTo: ({ params }) => {
      const token = params['token'];
      if (typeof token === 'string') inject(InvitationToken).set(token);
      return '/einladung';
    },
  },
  {
    path: '',
    providers: [
      provideTranslocoScope({
        scope: 'invitation',
        loader: {
          de: () => import('./i18n/de.json').then((m) => m.default),
          en: () => import('./i18n/en.json').then((m) => m.default),
        },
      }),
    ],
    loadComponent: () => import('./invitation-page').then((m) => m.InvitationPage),
  },
];
