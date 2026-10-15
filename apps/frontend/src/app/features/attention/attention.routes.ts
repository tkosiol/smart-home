import type { Routes } from '@angular/router';
import { provideAttentionTexts } from './attention-texts';

// The page loads lazily (loadComponent): the app config imports this folder's index at startup for
// provideAttentionFeature(), and must not pull the page into the initial bundle with it.

/** `/hinweise`: all open notices, `?art=<kind>` preselects one kind. */
export const attentionRoutes: Routes = [
  {
    path: '',
    providers: [provideAttentionTexts()],
    loadComponent: () => import('./attention-page').then((m) => m.AttentionPage),
  },
];
