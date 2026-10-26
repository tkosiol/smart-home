import type { Routes } from '@angular/router';

export { provideGatewaysFeature } from './gateways-feature';

// The app config imports this index at startup for provideGatewaysFeature(), so each route is only a lazy
// hop: the routes behind it (pages, texts, scopes) stay out of the initial bundle (#101).

/** `/mehr/gateways`. */
export const gatewaysRoutes: Routes = [
  { path: '', loadChildren: () => import('./gateways.routes').then((m) => m.gatewaysRoutes) },
];
