import type { Routes } from '@angular/router';
import { provideDevicesTexts } from './devices-texts';

// Reached through the lazy hop in this folder's index, so neither these routes nor their texts
// belong to the initial bundle (#101).

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
