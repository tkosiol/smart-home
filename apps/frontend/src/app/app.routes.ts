import { Routes } from '@angular/router';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import { signedIn } from './core/auth';
import { hasHousehold, minRole } from './core/household';
import { Shell } from './shell';

/**
 * Every page lives inside the shell, which only matches for signed-in users with a household; the
 * sign-in page stands beside it. Whoever is not signed in is sent to the sign-in page by the
 * guard, whoever has no household to the set-up page (`/einrichten`, outside the shell and only
 * for the signed in: it must not require a household, or the guard would send the user in circles).
 */
export const routes: Routes = [
  {
    path: 'anmelden',
    title: marker('app.title.signIn'),
    loadChildren: () => import('./features/auth').then((m) => m.authRoutes),
  },
  {
    // Outside the shell and without a guard: the invited may be signed in or not. The route's own
    // title is fixed, so the token never reaches the page title.
    path: 'einladung',
    title: marker('app.title.invitation'),
    loadChildren: () => import('./features/invitation').then((m) => m.invitationRoutes),
  },
  {
    path: 'einrichten',
    title: marker('app.title.setup'),
    canMatch: [signedIn],
    loadChildren: () => import('./features/households').then((m) => m.setupRoutes),
  },
  {
    path: '',
    component: Shell,
    canMatch: [signedIn, hasHousehold],
    children: [
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
      {
        path: 'haushalte',
        title: marker('app.title.switchHousehold'),
        loadChildren: () => import('./features/households').then((m) => m.switchRoutes),
      },
      // Before 'mehr': the more feature does not mount these pages itself (features never import each other).
      {
        path: 'mehr/haushalt',
        title: marker('app.title.household'),
        canMatch: [minRole('owner')],
        loadChildren: () => import('./features/households').then((m) => m.householdRoutes),
      },
      {
        path: 'mehr/mitglieder',
        title: marker('app.title.members'),
        canMatch: [minRole('viewer')],
        loadChildren: () => import('./features/households').then((m) => m.memberRoutes),
      },
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
    ],
  },
  // Safety net: the guard already redirects, so this is only reached when it lets nothing match.
  { path: '**', redirectTo: 'anmelden' },
];
