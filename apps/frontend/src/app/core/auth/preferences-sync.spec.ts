import { DOCUMENT, importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { provideRouter } from '@angular/router';
import {
  DEFAULT_PERSONAL_APPEARANCE,
  type Language,
  type Me,
  type PersonalAppearance,
} from '@smart/contracts';
import { APPEARANCE_STORE, MemoryAppearanceStore, ThemeService, UiSnackbar } from '@smart/ui';
import { API_FETCH } from '../api';
import { BROWSER_LANGUAGES, LANGUAGE_STORE, LanguageService } from '../i18n';
import { OnlineStatus } from '../pwa';
import { apiError, json, MemoryMeCache, TEST_ME } from '../../testing/auth-testing';
import { AuthService } from './auth.service';
import { ME_CACHE } from './me-cache';
import { PENDING_PREFERENCES, type PendingPreferences } from './pending-preferences';
import { PreferencesSync } from './preferences-sync';

const DARK: PersonalAppearance = { mode: 'dark', contrast: 'system' };
const HIGH: PersonalAppearance = { mode: 'light', contrast: 'high' };

class MemoryPending {
  value: PendingPreferences | null = null;
  load = () => this.value;
  save = (value: PendingPreferences) => void (this.value = value);
  clear = () => void (this.value = null);
}

/** What the fake server knows about the user; a PUT changes it and answers with the new user. */
function setup(options: { cached?: Me | null; pending?: PendingPreferences | null } = {}) {
  let server: Me = TEST_ME;
  let unreachable = false;
  let failPut: (() => Response) | null = null;
  const puts: { body: unknown; at: number }[] = [];
  const calls: string[] = [];
  const release: (() => void)[] = [];
  let holdPuts = false;

  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    calls.push(`${init?.method} ${path}`);
    if (unreachable) throw new TypeError('Failed to fetch');
    if (path.endsWith('/me/preferences')) {
      const body = JSON.parse(String(init?.body)) as Partial<Me>;
      puts.push({ body, at: Date.now() });
      if (holdPuts) await new Promise<void>((resolve) => release.push(resolve));
      if (failPut) return failPut();
      server = { ...server, ...body };
      return json(server);
    }
    return json(server);
  });
  const online = signal(true);
  const cache = new MemoryMeCache(options.cached ?? null);
  const pending = new MemoryPending();
  pending.value = options.pending ?? null;
  const appearanceStore = new MemoryAppearanceStore();
  const languageStore = { value: null as Language | null };
  const show = vi.fn().mockResolvedValue('dismissed');

  TestBed.configureTestingModule({
    providers: [
      importProvidersFrom(
        TranslocoTestingModule.forRoot({
          langs: { de: {}, en: {} },
          translocoConfig: { availableLangs: ['de', 'en'], defaultLang: 'de' },
        }),
      ),
      provideRouter([{ path: '**', children: [] }]),
      { provide: API_FETCH, useValue: fetchFn },
      { provide: ME_CACHE, useValue: cache },
      { provide: OnlineStatus, useValue: { online } },
      { provide: PENDING_PREFERENCES, useValue: pending },
      { provide: APPEARANCE_STORE, useValue: appearanceStore },
      {
        provide: LANGUAGE_STORE,
        useValue: {
          load: () => languageStore.value,
          save: (value: Language) => (languageStore.value = value),
          watch: () => () => undefined,
        },
      },
      { provide: BROWSER_LANGUAGES, useValue: [] },
      { provide: UiSnackbar, useValue: { show } },
    ],
  });
  const sync = TestBed.inject(PreferencesSync);
  return {
    sync,
    auth: TestBed.inject(AuthService),
    theme: TestBed.inject(ThemeService),
    language: TestBed.inject(LanguageService),
    html: TestBed.inject(DOCUMENT).documentElement,
    appearanceStore,
    cache,
    pending,
    online,
    show,
    puts,
    calls,
    fetchFn,
    setServer: (me: Me) => (server = me),
    setUnreachable: (value: boolean) => (unreachable = value),
    failPutWith: (response: (() => Response) | null) => (failPut = response),
    holdPuts: () => (holdPuts = true),
    releasePuts: () => release.splice(0).forEach((resolve) => resolve()),
  };
}

/** Lets effects, promises and the debounce timer run for `ms`. */
async function pass(ms = 0) {
  TestBed.tick();
  await vi.advanceTimersByTimeAsync(ms);
  TestBed.tick();
}

describe('PreferencesSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.setAttribute('lang', 'de');
    document.documentElement.removeAttribute('style');
  });

  describe('taking over the account', () => {
    it('applies appearance and language of the server after load, without sending anything', async () => {
      const harness = setup();
      harness.setServer({ ...TEST_ME, locale: 'en', appearance: DARK });
      await harness.auth.load();
      await pass(1000);
      expect(harness.theme.personal()).toEqual(DARK);
      expect(harness.language.language()).toBe('en');
      expect(harness.puts).toEqual([]);
    });

    it('sets <html lang> from the language of the server', async () => {
      const harness = setup();
      harness.setServer({ ...TEST_ME, locale: 'en' });
      await harness.auth.load();
      await pass();
      expect(harness.html.lang).toBe('en');
    });

    it('keeps the adopted values on the device as start values and boot cache source', async () => {
      const harness = setup();
      harness.setServer({ ...TEST_ME, locale: 'en', appearance: DARK });
      await harness.auth.load();
      await pass();
      expect(harness.appearanceStore.personal).toEqual(DARK);
      expect(harness.language.language()).toBe('en');
    });

    it('takes over the copy of an offline start, without sending', async () => {
      const harness = setup({ cached: { ...TEST_ME, locale: 'en', appearance: HIGH } });
      harness.setUnreachable(true);
      await harness.auth.load();
      await pass(1000);
      expect(harness.auth.status()).toBe('offline');
      expect(harness.theme.personal()).toEqual(HIGH);
      expect(harness.language.language()).toBe('en');
      expect(harness.puts).toEqual([]);
    });
  });

  describe('changes by the user', () => {
    it('sends one request 500 ms after the last of several quick changes', async () => {
      const harness = setup();
      await harness.auth.load();
      await pass();

      harness.theme.setPersonal({ mode: 'dark', contrast: 'system' });
      await pass(200);
      harness.theme.setPersonal(HIGH);
      await pass(200);
      harness.language.setLanguage('en');
      await pass(499);
      expect(harness.puts).toEqual([]);

      await pass(1);
      expect(harness.puts.map((put) => put.body)).toEqual([{ appearance: HIGH, locale: 'en' }]);
      await pass(2000);
      expect(harness.puts).toHaveLength(1);
    });

    it('sends only what the user changed', async () => {
      const harness = setup();
      await harness.auth.load();
      harness.language.setLanguage('en');
      await pass(500);
      expect(harness.puts.map((put) => put.body)).toEqual([{ locale: 'en' }]);
    });

    it('sends the defaults after a reset', async () => {
      const harness = setup();
      harness.setServer({ ...TEST_ME, appearance: DARK });
      await harness.auth.load();
      await pass();
      harness.theme.resetPersonal();
      await pass(500);
      expect(harness.puts.map((put) => put.body)).toEqual([
        { appearance: DEFAULT_PERSONAL_APPEARANCE },
      ]);
    });

    it('updates the user and the copy on the device with the answer', async () => {
      const harness = setup();
      await harness.auth.load();
      harness.theme.setPersonal(DARK);
      await pass(500);
      expect(harness.auth.me()?.appearance).toEqual(DARK);
      expect(harness.cache.me?.appearance).toEqual(DARK);
      expect(harness.pending.value).toBeNull();
    });

    it('does not send the answer back again', async () => {
      const harness = setup();
      await harness.auth.load();
      harness.theme.setPersonal(DARK);
      await pass(500);
      await pass(2000);
      expect(harness.puts).toHaveLength(1);
      expect(harness.theme.personal()).toEqual(DARK);
    });

    it('sends a change made while a request is running afterwards', async () => {
      const harness = setup();
      await harness.auth.load();
      harness.holdPuts();
      harness.theme.setPersonal(DARK);
      await pass(500);
      expect(harness.puts).toHaveLength(1);

      harness.theme.setPersonal(HIGH);
      await pass(500);
      harness.releasePuts();
      await pass();
      // The answer to the first request must not undo the second change.
      expect(harness.theme.personal()).toEqual(HIGH);
      harness.releasePuts();
      await pass(500);
      expect(harness.puts.map((put) => put.body)).toEqual([
        { appearance: DARK },
        { appearance: HIGH },
      ]);
      expect(harness.theme.personal()).toEqual(HIGH);
      expect(harness.pending.value).toBeNull();
    });

    it('sends a change made while a request ran and failed', async () => {
      const harness = setup();
      await harness.auth.load();
      harness.holdPuts();
      harness.failPutWith(() => {
        harness.failPutWith(null);
        return apiError('internal', 500);
      });
      harness.theme.setPersonal(DARK);
      await pass(500);
      harness.theme.setPersonal(HIGH);
      await pass(500);
      expect(harness.puts).toHaveLength(1);

      harness.releasePuts();
      await pass();
      harness.releasePuts();
      await pass();
      expect(harness.puts.map((put) => put.body)).toEqual([
        { appearance: DARK },
        { appearance: HIGH },
      ]);
      expect(harness.pending.value).toBeNull();
      expect(harness.theme.personal()).toEqual(HIGH);
    });

    it('stops sending when the service is destroyed', async () => {
      const harness = setup();
      await harness.auth.load();
      harness.theme.setPersonal(DARK);
      TestBed.resetTestingModule();
      await vi.advanceTimersByTimeAsync(1000);
      expect(harness.puts).toEqual([]);
    });
  });

  describe('a failing request', () => {
    it('shows a snackbar and keeps the local state', async () => {
      const harness = setup();
      await harness.auth.load();
      harness.failPutWith(() => apiError('internal', 500));
      harness.theme.setPersonal(DARK);
      harness.language.setLanguage('en');
      await pass(500);
      expect(harness.show).toHaveBeenCalledTimes(1);
      expect(harness.theme.personal()).toEqual(DARK);
      expect(harness.language.language()).toBe('en');
      expect(harness.auth.status()).toBe('signedIn');
    });

    it('sends the failed change again with the next change', async () => {
      const harness = setup();
      await harness.auth.load();
      harness.failPutWith(() => apiError('internal', 500));
      harness.theme.setPersonal(DARK);
      await pass(500);

      harness.failPutWith(null);
      harness.language.setLanguage('en');
      await pass(500);
      expect(harness.puts.at(-1)?.body).toEqual({ appearance: DARK, locale: 'en' });
      expect(harness.pending.value).toBeNull();
    });

    it('gives up on a change the server rejects, so later server values still arrive', async () => {
      const harness = setup();
      await harness.auth.load();
      harness.failPutWith(() => apiError('validation.failed', 400));
      harness.theme.setPersonal(DARK);
      await pass(500);
      expect(harness.show).toHaveBeenCalledTimes(1);
      expect(harness.pending.value).toBeNull();
      expect(harness.theme.personal()).toEqual(DARK);

      harness.failPutWith(null);
      harness.setServer({ ...TEST_ME, appearance: HIGH });
      await harness.auth.load();
      await pass();
      expect(harness.theme.personal()).toEqual(HIGH);
    });
  });

  describe('changes without a connection', () => {
    it('does not send while the browser is offline, and sends when it is back', async () => {
      const harness = setup();
      await harness.auth.load();
      harness.online.set(false);
      await pass();
      harness.theme.setPersonal(DARK);
      await pass(2000);
      expect(harness.puts).toEqual([]);
      expect(harness.theme.personal()).toEqual(DARK);

      harness.online.set(true);
      await pass();
      expect(harness.puts.map((put) => put.body)).toEqual([{ appearance: DARK }]);
      expect(harness.show).not.toHaveBeenCalled();
    });

    it('sends the change before it takes over the user of the next load, and keeps it', async () => {
      const harness = setup({ cached: TEST_ME });
      harness.setUnreachable(true);
      await harness.auth.load();
      await pass();
      expect(harness.auth.status()).toBe('offline');

      harness.theme.setPersonal(DARK);
      harness.language.setLanguage('en');
      await pass(2000);
      expect(harness.puts).toEqual([]);

      harness.setUnreachable(false);
      harness.setServer({ ...TEST_ME, displayName: 'Till K.', appearance: HIGH, locale: 'de' });
      await harness.auth.load();
      await pass();

      expect(harness.calls.filter((call) => call !== 'GET /api/v1/me')).toEqual([
        'PUT /api/v1/me/preferences',
      ]);
      expect(harness.calls.indexOf('PUT /api/v1/me/preferences')).toBeGreaterThan(
        harness.calls.indexOf('GET /api/v1/me'),
      );
      expect(harness.puts.map((put) => put.body)).toEqual([{ appearance: DARK, locale: 'en' }]);
      expect(harness.theme.personal()).toEqual(DARK);
      expect(harness.language.language()).toBe('en');
      expect(harness.auth.me()).toMatchObject({
        displayName: 'Till K.',
        appearance: DARK,
        locale: 'en',
      });
    });

    it('does not let a stale user from the server undo the change while it is on its way', async () => {
      const harness = setup({ cached: TEST_ME });
      harness.setUnreachable(true);
      await harness.auth.load();
      harness.theme.setPersonal(DARK);
      harness.setUnreachable(false);
      harness.setServer({ ...TEST_ME, appearance: HIGH });
      harness.holdPuts();
      await harness.auth.load();
      await pass();
      expect(harness.theme.personal()).toEqual(DARK);
      harness.releasePuts();
      await pass();
      expect(harness.theme.personal()).toEqual(DARK);
    });

    it('sends a change of an earlier visit before it takes over the user', async () => {
      const harness = setup({ pending: { appearance: DARK } });
      harness.setServer({ ...TEST_ME, appearance: HIGH });
      await harness.auth.load();
      await pass();
      expect(harness.calls).toEqual(['GET /api/v1/me', 'PUT /api/v1/me/preferences']);
      expect(harness.theme.personal()).toEqual(DARK);
      expect(harness.auth.me()?.appearance).toEqual(DARK);
    });

    it('does not ask the server while it is unreachable', async () => {
      const harness = setup({ cached: TEST_ME, pending: { locale: 'en' } });
      harness.setUnreachable(true);
      await harness.auth.load();
      await pass(2000);
      expect(harness.calls).toEqual(['GET /api/v1/me']);
      expect(harness.pending.value).toEqual({ locale: 'en' });
    });
  });

  describe('signed out', () => {
    it('sends nothing for a change while nobody is signed in', async () => {
      const harness = setup();
      harness.theme.setPersonal(DARK);
      harness.language.setLanguage('en');
      await pass(2000);
      expect(harness.puts).toEqual([]);
      expect(harness.pending.value).toBeNull();
    });

    it('forgets a change that was not sent when the session ends', async () => {
      const harness = setup();
      await harness.auth.load();
      harness.theme.setPersonal(DARK);
      expect(harness.pending.value).not.toBeNull();
      harness.auth.handleUnauthorized();
      await pass(2000);
      expect(harness.puts).toEqual([]);
      expect(harness.pending.value).toBeNull();
    });

    it('keeps a change that could not be sent when the first load did not reach the server', async () => {
      const harness = setup({ pending: { locale: 'en' } });
      harness.setUnreachable(true);
      await harness.auth.load();
      await pass();
      expect(harness.auth.connectionLost()).toBe(true);
      expect(harness.pending.value).toEqual({ locale: 'en' });
    });
  });
});
