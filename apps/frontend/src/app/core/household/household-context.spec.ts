import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { Me } from '@smart/contracts';
import { UiFormatContext } from '@smart/ui';
import { API_FETCH } from '../api';
import { AuthService, ME_CACHE } from '../auth';
import {
  MemoryMeCache,
  TEST_ME,
  apiError,
  householdOf,
  json,
  meWith,
} from '../../testing/auth-testing';
import { HouseholdContext } from './household-context';
import { hasHousehold } from './guards';

const berlin = householdOf('Berlin', { timezone: 'Europe/Berlin' });
const auckland = householdOf('Auckland', { timezone: 'Pacific/Auckland', role: 'member' });

interface Setup {
  /** What the server answers to `GET /me`. */
  me: Me;
  /** What the server answers to `PUT /me`; a function sees the requested household id. */
  put?: (householdId: string) => Response;
  cache?: MemoryMeCache;
  offline?: boolean;
  /** `PUT /me` answers only after this promise resolved. */
  holdPut?: Promise<void>;
}

async function setup({ me, put, cache = new MemoryMeCache(), offline = false, holdPut }: Setup) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const state = { me, ended: false };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'einrichten', children: [] },
        { path: '', canMatch: [hasHousehold], children: [{ path: '**', children: [] }] },
      ]),
      {
        provide: API_FETCH,
        useValue: async (path: string, init: RequestInit = {}) => {
          const method = init.method ?? 'GET';
          calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
          if (offline) throw new TypeError('Failed to fetch');
          if (method === 'POST' && path.endsWith('/auth/logout')) {
            state.ended = true;
            return new Response(null, { status: 204 });
          }
          if (state.ended) return apiError('auth.required', 401);
          if (method === 'PUT') {
            await holdPut;
            return (put ?? (() => json(state.me)))(JSON.parse(String(init.body)).householdId);
          }
          return json(state.me);
        },
      },
      { provide: ME_CACHE, useValue: cache },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  const auth = TestBed.inject(AuthService);
  const context = TestBed.inject(HouseholdContext);
  const format = TestBed.inject(UiFormatContext);
  await auth.load();
  TestBed.tick();
  return { auth, context, format, calls, state, router: TestBed.inject(Router) };
}

describe('HouseholdContext', () => {
  describe('current household', () => {
    it('follows currentHouseholdId', async () => {
      const { context } = await setup({ me: meWith([berlin, auckland], auckland.id) });
      expect(context.current()).toEqual(auckland);
      expect(context.households()).toEqual([berlin, auckland]);
    });

    it.each([[null], ['household-unknown']])(
      'falls back to the first household when currentHouseholdId is %s',
      async (id) => {
        const { context } = await setup({ me: meWith([berlin, auckland], id) });
        expect(context.current()).toEqual(berlin);
      },
    );

    it('is null without a household', async () => {
      const { context } = await setup({ me: meWith([]) });
      expect(context.current()).toBeNull();
      expect(context.households()).toEqual([]);
    });

    it('is null while nobody is signed in', async () => {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          { provide: API_FETCH, useValue: async () => apiError('auth.required', 401) },
          { provide: ME_CACHE, useValue: new MemoryMeCache() },
        ],
      });
      const context = TestBed.inject(HouseholdContext);
      await TestBed.inject(AuthService).load();
      expect(context.current()).toBeNull();
    });
  });

  describe('time zone', () => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    it('is the one of the current household', async () => {
      const { format } = await setup({ me: meWith([berlin, auckland], auckland.id) });
      expect(format.timeZone()).toBe('Pacific/Auckland');
    });

    it('is the browser zone without a household', async () => {
      const { format } = await setup({ me: meWith([]) });
      expect(format.timeZone()).toBe(browserZone);
    });

    it('changes at once when switching the household', async () => {
      const { context, format } = await setup({
        me: meWith([berlin, auckland], berlin.id),
        put: () => json(meWith([berlin, auckland], auckland.id)),
      });
      expect(format.timeZone()).toBe('Europe/Berlin');
      await context.switchTo(auckland.id);
      TestBed.tick();
      expect(format.timeZone()).toBe('Pacific/Auckland');
    });

    it('changes when the zone of the current household changes in a new me', async () => {
      const { auth, format } = await setup({ me: meWith([berlin], berlin.id) });
      auth.updateMe(meWith([{ ...berlin, timezone: 'America/New_York' }], berlin.id));
      TestBed.tick();
      expect(format.timeZone()).toBe('America/New_York');
    });

    it('comes from the device copy when the app starts offline', async () => {
      const { format, auth } = await setup({
        me: TEST_ME,
        cache: new MemoryMeCache(meWith([auckland])),
        offline: true,
      });
      expect(auth.status()).toBe('offline');
      expect(format.timeZone()).toBe('Pacific/Auckland');
    });
  });

  describe('switchTo', () => {
    it('asks the server, then adopts the answered me', async () => {
      const { context, auth, calls } = await setup({
        me: meWith([berlin, auckland], berlin.id),
        put: () => json(meWith([berlin, auckland], auckland.id)),
      });
      await context.switchTo(auckland.id);
      expect(calls.at(-1)).toEqual({
        method: 'PUT',
        path: '/api/v1/me',
        body: { householdId: auckland.id },
      });
      expect(context.current()).toEqual(auckland);
      expect(auth.me()?.currentHouseholdId).toBe(auckland.id);
    });

    it('drops the answer when the user signed out while the server was asked', async () => {
      let answer!: () => void;
      const { context, auth } = await setup({
        me: meWith([berlin, auckland], berlin.id),
        put: () => json(meWith([berlin, auckland], auckland.id)),
        holdPut: new Promise<void>((resolve) => (answer = resolve)),
      });
      const switching = context.switchTo(auckland.id);
      await auth.logout();
      answer();
      await switching;
      expect(auth.status()).toBe('signedOut');
      expect(auth.me()).toBeNull();
    });

    it('drops the answer when another user is signed in by then', async () => {
      let answer!: () => void;
      const { context, auth } = await setup({
        me: meWith([berlin, auckland], berlin.id),
        put: () => json(meWith([berlin, auckland], auckland.id)),
        holdPut: new Promise<void>((resolve) => (answer = resolve)),
      });
      const switching = context.switchTo(auckland.id);
      auth.updateMe({ ...meWith([berlin], berlin.id), id: 'someone-else' });
      answer();
      await switching;
      expect(auth.me()?.id).toBe('someone-else');
      expect(context.current()).toEqual(berlin);
    });

    it('keeps the current household when the server refuses', async () => {
      const { context } = await setup({
        me: meWith([berlin, auckland], berlin.id),
        put: () => apiError('household.notFound', 404),
      });
      await expect(context.switchTo(auckland.id)).rejects.toMatchObject({ status: 404 });
      expect(context.current()).toEqual(berlin);
    });
  });

  describe('accessChanged', () => {
    it('moves to a remaining household when the current one was taken away', async () => {
      const { context, state, format } = await setup({ me: meWith([berlin, auckland], berlin.id) });
      state.me = meWith([auckland], null);
      await context.accessChanged();
      expect(context.current()).toEqual(auckland);
      TestBed.tick();
      expect(format.timeZone()).toBe('Pacific/Auckland');
    });

    it('leads the next navigation to /einrichten when no household is left', async () => {
      const { context, state, router } = await setup({ me: meWith([berlin], berlin.id) });
      await router.navigateByUrl('/raeume');
      expect(router.url).toBe('/raeume');
      state.me = meWith([]);
      await context.accessChanged();
      expect(context.current()).toBeNull();
      expect(router.url).toBe('/einrichten');
    });

    it('stays where it is while the household is still accessible', async () => {
      const { context, router } = await setup({ me: meWith([berlin], berlin.id) });
      await router.navigateByUrl('/raeume');
      await context.accessChanged();
      expect(router.url).toBe('/raeume');
    });
  });
});
