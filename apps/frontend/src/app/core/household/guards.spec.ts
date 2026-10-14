import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type CanMatchFn, type Route } from '@angular/router';
import type { Me } from '@smart/contracts';
import { API_FETCH } from '../api';
import { ME_CACHE } from '../auth';
import {
  MemoryMeCache,
  TEST_ME,
  apiError,
  householdOf,
  json,
  meWith,
} from '../../testing/auth-testing';
import { hasHousehold, minRole, platformAdmin } from './guards';

/** Runs a guard the way the router does; `me` null answers 401. */
async function run(guard: CanMatchFn, me: Me | null) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      {
        provide: API_FETCH,
        useValue: async () => (me ? json(me) : apiError('auth.required', 401)),
      },
      { provide: ME_CACHE, useValue: new MemoryMeCache() },
    ],
  });
  const result = await TestBed.runInInjectionContext(() => guard({} as Route, [], {} as never));
  const router = TestBed.inject(Router);
  return typeof result === 'boolean' ? result : router.serializeUrl(result as never);
}

describe('hasHousehold', () => {
  it('lets a user with a household through', async () => {
    expect(await run(hasHousehold, TEST_ME)).toBe(true);
  });

  it('sends a user without a household to /einrichten', async () => {
    expect(await run(hasHousehold, meWith([]))).toBe('/einrichten');
  });

  it('does not let anybody through while nobody is signed in', async () => {
    expect(await run(hasHousehold, null)).toBe('/einrichten');
  });
});

describe('minRole', () => {
  const as = (role: 'viewer' | 'member' | 'owner') => meWith([householdOf('Berlin', { role })]);

  it.each([
    ['owner', 'owner', true],
    ['member', 'owner', '/'],
    ['viewer', 'member', '/'],
    ['member', 'member', true],
    ['owner', 'viewer', true],
  ] as const)('as %s, minRole(%s) answers %s', async (role, minimum, expected) => {
    expect(await run(minRole(minimum), as(role))).toBe(expected);
  });

  it('is closed without a household', async () => {
    expect(await run(minRole('viewer'), meWith([]))).toBe('/');
  });

  it('is closed while nobody is signed in', async () => {
    expect(await run(minRole('viewer'), null)).toBe('/');
  });
});

describe('platformAdmin', () => {
  it('lets the platform admin through', async () => {
    expect(await run(platformAdmin, { ...TEST_ME, isPlatformAdmin: true })).toBe(true);
  });

  it('sends everybody else to the settings', async () => {
    expect(await run(platformAdmin, TEST_ME)).toBe('/mehr/einstellungen');
  });

  it('is closed while nobody is signed in (me is null)', async () => {
    expect(await run(platformAdmin, null)).toBe('/mehr/einstellungen');
  });
});
