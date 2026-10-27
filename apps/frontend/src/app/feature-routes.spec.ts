import type { Route, Routes } from '@angular/router';
import * as attention from './features/attention';
import * as devices from './features/devices';
import * as gateways from './features/gateways';
import * as households from './features/households';
import * as settings from './features/settings';

// The app config imports these indexes at startup for their provide*Feature(). Their route
// exports may therefore only point one lazy step further: page routes, texts and scopes behind
// them stay out of the initial bundle (#101).
const INDEX_ROUTES: Record<string, Routes> = {
  attentionRoutes: attention.attentionRoutes,
  deviceRoutes: devices.deviceRoutes,
  devicesRoutes: devices.devicesRoutes,
  gatewaysRoutes: gateways.gatewaysRoutes,
  setupRoutes: households.setupRoutes,
  switchRoutes: households.switchRoutes,
  householdRoutes: households.householdRoutes,
  memberRoutes: households.memberRoutes,
  settingsRoutes: settings.settingsRoutes,
};

const onlyALazyHop = (route: Route) =>
  Object.keys(route).every((key) => key === 'path' || key === 'loadChildren') &&
  typeof route.loadChildren === 'function';

describe('feature indexes', () => {
  it.each(Object.entries(INDEX_ROUTES))('%s is only a lazy hop', (_name, routes) => {
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every(onlyALazyHop)).toBe(true);
  });

  it.each(Object.entries(INDEX_ROUTES))('%s reaches routes with a page', async (_name, routes) => {
    const children = (await routes[0].loadChildren!()) as Routes;
    expect(children.some((route) => route.loadComponent || route.children)).toBe(true);
  });
});
