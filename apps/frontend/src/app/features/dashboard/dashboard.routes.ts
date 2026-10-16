import type { Routes } from '@angular/router';
import { DashboardPage } from './dashboard-page';
import { provideDashboardTexts } from './dashboard-texts';

export const dashboardRoutes: Routes = [
  {
    path: '',
    component: DashboardPage,
    providers: [provideDashboardTexts()],
  },
];
