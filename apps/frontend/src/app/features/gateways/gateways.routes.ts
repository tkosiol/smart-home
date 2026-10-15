import type { Routes } from '@angular/router';
import { provideGatewaysTexts } from './gateways-texts';

// The page loads lazily (loadComponent): the app config imports this folder's index at startup for
// provideGatewaysFeature(), and must not pull the page into the initial bundle with it.

/** `/mehr/gateways`. */
export const gatewaysRoutes: Routes = [
  {
    path: '',
    providers: [provideGatewaysTexts()],
    loadComponent: () => import('./gateways-page').then((m) => m.GatewaysPage),
  },
];
