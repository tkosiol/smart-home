import type { Routes } from '@angular/router';

export { provideHouseholdsFeature } from './households-feature';

// The app config imports this index at startup for provideHouseholdsFeature(), so each route is only a lazy
// hop: the routes behind it (pages, texts, scopes) stay out of the initial bundle (#101).

/** `/einrichten`. */
export const setupRoutes: Routes = [
  { path: '', loadChildren: () => import('./households.routes').then((m) => m.setupRoutes) },
];

/** `/haushalte`. */
export const switchRoutes: Routes = [
  { path: '', loadChildren: () => import('./households.routes').then((m) => m.switchRoutes) },
];

/** `/mehr/haushalt`. */
export const householdRoutes: Routes = [
  { path: '', loadChildren: () => import('./households.routes').then((m) => m.householdRoutes) },
];

/** `/mehr/mitglieder`. */
export const memberRoutes: Routes = [
  { path: '', loadChildren: () => import('./households.routes').then((m) => m.memberRoutes) },
];
