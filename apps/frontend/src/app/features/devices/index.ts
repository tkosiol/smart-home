import type { Routes } from '@angular/router';

export { provideDevicesFeature } from './devices-feature';

// The app config imports this index at startup for provideDevicesFeature(), so each route is only a lazy
// hop: the routes behind it (pages, texts, scopes) stay out of the initial bundle (#101).

/** `/geraete`. */
export const devicesRoutes: Routes = [
  { path: '', loadChildren: () => import('./devices.routes').then((m) => m.devicesRoutes) },
];

/** `/geraete/:id`. */
export const deviceRoutes: Routes = [
  { path: '', loadChildren: () => import('./devices.routes').then((m) => m.deviceRoutes) },
];
