import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadChildren: () => import('./features/dashboard').then((m) => m.dashboardRoutes),
  },
  { path: 'raeume', loadChildren: () => import('./features/rooms').then((m) => m.roomsRoutes) },
  {
    path: 'geraete',
    loadChildren: () => import('./features/devices').then((m) => m.devicesRoutes),
  },
  // Before 'mehr': the more feature does not mount the settings itself (features never import each other).
  {
    path: 'mehr/einstellungen',
    loadChildren: () => import('./features/settings').then((m) => m.settingsRoutes),
  },
  { path: 'mehr', loadChildren: () => import('./features/more').then((m) => m.moreRoutes) },
  { path: '**', loadComponent: () => import('./shell/not-found').then((m) => m.NotFound) },
];
