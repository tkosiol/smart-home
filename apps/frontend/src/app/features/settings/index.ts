import type { Routes } from '@angular/router';

export { provideSettingsFeature } from './settings-feature';

// The app config imports this index at startup for provideSettingsFeature(), so each route is only a lazy
// hop: the routes behind it (pages, texts, scopes) stay out of the initial bundle (#101).

/** `/mehr/einstellungen`. */
export const settingsRoutes: Routes = [
  { path: '', loadChildren: () => import('./settings.routes').then((m) => m.settingsRoutes) },
];
