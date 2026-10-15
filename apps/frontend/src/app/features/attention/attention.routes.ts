import type { Routes } from '@angular/router';
import { provideAttentionTexts } from './attention-texts';

// Reached through the lazy `attentionRoutes` of this folder's index, so neither these routes nor
// the texts provider belong to the initial bundle.

/** `/hinweise`: all open notices, `?art=<kind>` preselects one kind. */
export const attentionRoutes: Routes = [
  {
    path: '',
    providers: [provideAttentionTexts()],
    loadComponent: () => import('./attention-page').then((m) => m.AttentionPage),
  },
];
