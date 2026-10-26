import type { Routes } from '@angular/router';
import { provideGatewaysTexts } from './gateways-texts';

// Reached through the lazy hop in this folder's index, so neither these routes nor their texts
// belong to the initial bundle (#101).

/** `/mehr/gateways`. */
export const gatewaysRoutes: Routes = [
  {
    path: '',
    providers: [provideGatewaysTexts()],
    loadComponent: () => import('./gateways-page').then((m) => m.GatewaysPage),
  },
];
