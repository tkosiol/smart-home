import { Routes } from '@angular/router';
import { marker } from '@jsverse/transloco-keys-manager/marker';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: marker('app.title.overview'),
    loadChildren: () => import('./features/dashboard').then((m) => m.dashboardRoutes),
  },
  {
    path: 'raeume',
    title: marker('app.title.rooms'),
    loadChildren: () => import('./features/rooms').then((m) => m.roomsRoutes),
  },
  {
    path: 'geraete',
    title: marker('app.title.devices'),
    loadChildren: () => import('./features/devices').then((m) => m.devicesRoutes),
  },
  // Before 'mehr': the more feature does not mount the settings itself (features never import each other).
  {
    path: 'mehr/einstellungen',
    title: marker('app.title.settings'),
    loadChildren: () => import('./features/settings').then((m) => m.settingsRoutes),
  },
  {
    path: 'mehr',
    title: marker('app.title.more'),
    loadChildren: () => import('./features/more').then((m) => m.moreRoutes),
  },
  {
    path: '**',
    title: marker('app.title.notFound'),
    loadComponent: () => import('./shell/not-found').then((m) => m.NotFound),
  },
];
