import type { Provider } from '@angular/core';
import { DEFAULT_PERSONAL_APPEARANCE, type HouseholdSummary, type Me } from '@smart/contracts';
import { API_FETCH } from '../core/api';
import { ME_CACHE, type MeCache } from '../core/auth';

export const TEST_HOUSEHOLD: HouseholdSummary = {
  id: '5d7c6c8e-0000-4000-8000-0000000000a1',
  name: 'Haus Sonnenweg',
  timezone: 'Europe/Berlin',
  role: 'owner',
};

export const TEST_ME: Me = {
  id: '5d7c6c8e-0000-4000-8000-000000000001',
  email: 'till@example.org',
  displayName: 'Till',
  locale: 'de',
  appearance: DEFAULT_PERSONAL_APPEARANCE,
  isPlatformAdmin: false,
  households: [TEST_HOUSEHOLD],
  currentHouseholdId: TEST_HOUSEHOLD.id,
};

/** `TEST_ME` with other households; the current one defaults to the first. */
export function meWith(households: HouseholdSummary[], currentHouseholdId?: string | null): Me {
  return {
    ...TEST_ME,
    households,
    currentHouseholdId:
      currentHouseholdId === undefined ? (households[0]?.id ?? null) : currentHouseholdId,
  };
}

/** A household of the test user; the id is the name's slug, so households stay apart. */
export function householdOf(
  name: string,
  overrides: Partial<HouseholdSummary> = {},
): HouseholdSummary {
  return { ...TEST_HOUSEHOLD, id: `household-${name.toLowerCase()}`, name, ...overrides };
}

/** A device copy of the user that lives in memory; `cleared` records what the app removed. */
export class MemoryMeCache implements MeCache {
  themeBootCleared = false;
  constructor(public me: Me | null = null) {}
  load = () => this.me;
  save = (me: Me) => void (this.me = me);
  clear = () => void (this.me = null);
  clearThemeBoot = () => void (this.themeBootCleared = true);
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const apiError = (code: string, status: number, params?: Record<string, string | number>) =>
  json({ code, params, traceId: 'trace' }, status);

/** Providers that answer `GET /api/v1/me` with a signed-in user and keep the device copy in memory. */
export function signedInProviders(me: Me = TEST_ME): Provider[] {
  return [
    {
      provide: API_FETCH,
      useValue: async (input: RequestInfo | URL) =>
        String(input).endsWith('/me') ? json(me) : new Response(null, { status: 204 }),
    },
    { provide: ME_CACHE, useValue: new MemoryMeCache() },
  ];
}
