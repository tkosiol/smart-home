import type { Routes } from '@angular/router';

export { provideAttentionFeature } from './attention-feature';

/**
 * `/hinweise`. The app config imports this folder's index at startup for
 * `provideAttentionFeature()`, so what the route needs (its texts, the page) is behind a second
 * lazy hop: the initial bundle only carries this one line.
 */
export const attentionRoutes: Routes = [
  {
    path: '',
    loadChildren: () => import('./attention.routes').then((m) => m.attentionRoutes),
  },
];
