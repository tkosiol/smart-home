import type { Provider } from '@angular/core';
import type { Routes } from '@angular/router';
import { provideTranslocoScope } from '@jsverse/transloco';

// Pages load lazily (loadComponent): the app config imports this folder's index at startup for
// provideHouseholdsFeature(), and must not pull the pages into the initial bundle with it.

function households(): Provider {
  return provideTranslocoScope({
    scope: 'households',
    loader: {
      de: () => import('./i18n/de.json').then((m) => m.default),
      en: () => import('./i18n/en.json').then((m) => m.default),
    },
  });
}

/** `/einrichten`: stands outside the shell, because the user has no household to show yet. */
export const setupRoutes: Routes = [
  {
    path: '',
    providers: [households()],
    loadComponent: () => import('./setup-page').then((m) => m.SetupPage),
  },
];

/** `/haushalte`. */
export const switchRoutes: Routes = [
  {
    path: '',
    providers: [households()],
    loadComponent: () => import('./switch-page').then((m) => m.SwitchPage),
  },
];

/** `/mehr/haushalt`. */
export const householdRoutes: Routes = [
  {
    path: '',
    providers: [households()],
    loadComponent: () => import('./household-page').then((m) => m.HouseholdPage),
  },
];

/** `/mehr/mitglieder`. */
export const memberRoutes: Routes = [
  {
    path: '',
    providers: [households()],
    loadComponent: () => import('./members-page').then((m) => m.MembersPage),
  },
];
