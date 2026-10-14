import type { Routes } from '@angular/router';
import { provideDevicesTexts } from './devices-texts';

// The pages load lazily (loadComponent): the app config imports this folder's index at startup
// for provideDevicesFeature(), and must not pull the pages into the initial bundle with it.

/** `/geraete`. */
export const devicesRoutes: Routes = [
  {
    path: '',
    providers: [provideDevicesTexts()],
    loadComponent: () => import('./devices-page').then((m) => m.DevicesPage),
  },
];

/** `/geraete/:id`. */
export const deviceRoutes: Routes = [
  {
    path: '',
    providers: [provideDevicesTexts()],
    loadComponent: () => import('./device-page').then((m) => m.DevicePage),
  },
];
