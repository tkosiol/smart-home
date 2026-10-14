import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { API_FETCH } from '../api';
import { OnlineStatus } from '../pwa';
import { apiError, json, MemoryMeCache, TEST_ME } from '../../testing/auth-testing';
import { AuthService, START_LOAD_TIMEOUT_MS } from './auth.service';
import { ME_CACHE } from './me-cache';

type Responder = (path: string, init?: RequestInit) => Response | Promise<Response>;

function setup(respond: Responder, cached: typeof TEST_ME | null = null) {
  const online = signal(true);
  const cache = new MemoryMeCache(cached);
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    respond(String(input), init),
  );
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: API_FETCH, useValue: fetchFn },
      { provide: ME_CACHE, useValue: cache },
      { provide: OnlineStatus, useValue: { online } },
    ],
  });
  return {
    auth: TestBed.inject(AuthService),
    router: TestBed.inject(Router),
    online,
    cache,
    fetchFn,
  };
}

/** The request is gone before it reaches the server. */
const unreachable = () => {
  throw new TypeError('Failed to fetch');
};

describe('AuthService.load', () => {
  it('starts with an unknown status and no user', () => {
    const { auth } = setup(() => json(TEST_ME));
    expect(auth.status()).toBe('unknown');
    expect(auth.me()).toBeNull();
  });

  it('on success sets the user and keeps a copy for the offline start', async () => {
    const { auth, cache, fetchFn } = setup(() => json(TEST_ME));
    await auth.load();
    expect(auth.status()).toBe('signedIn');
    expect(auth.me()).toEqual(TEST_ME);
    expect(cache.me).toEqual(TEST_ME);
    expect(fetchFn).toHaveBeenCalledWith('/api/v1/me', expect.objectContaining({ method: 'GET' }));
  });

  it('copies only the fields of the schema into the cache', async () => {
    const { auth, cache } = setup(() => json({ ...TEST_ME, token: 'secret' }));
    await auth.load();
    expect(cache.me).toEqual(TEST_ME);
    expect(auth.me()).toEqual(TEST_ME);
  });

  it('on 401 signs out and deletes the copy, without navigating', async () => {
    const { auth, cache, router } = setup(() => apiError('auth.required', 401), TEST_ME);
    const navigate = vi.spyOn(router, 'navigate');
    await auth.load();
    expect(auth.status()).toBe('signedOut');
    expect(auth.me()).toBeNull();
    expect(cache.me).toBeNull();
    expect(auth.connectionLost()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('without a connection and with a copy starts offline with the copy', async () => {
    const { auth, cache } = setup(unreachable, TEST_ME);
    await auth.load();
    expect(auth.status()).toBe('offline');
    expect(auth.me()).toEqual(TEST_ME);
    expect(cache.me).toEqual(TEST_ME);
    expect(auth.connectionLost()).toBe(false);
  });

  it('without a connection and without a copy is signed out and says the connection is lost', async () => {
    const { auth } = setup(unreachable);
    await auth.load();
    expect(auth.status()).toBe('signedOut');
    expect(auth.me()).toBeNull();
    expect(auth.connectionLost()).toBe(true);
  });

  it('treats a server error like a lost connection', async () => {
    const { auth } = setup(() => apiError('internal', 502), TEST_ME);
    await auth.load();
    expect(auth.status()).toBe('offline');
    expect(auth.me()).toEqual(TEST_ME);
  });

  it('treats an answer that is not a user like a lost connection', async () => {
    const { auth } = setup(() => json({ unexpected: true }));
    await auth.load();
    expect(auth.status()).toBe('signedOut');
    expect(auth.connectionLost()).toBe(true);
  });

  describe('when the server does not answer', () => {
    /** A server that accepts the connection and never replies; only the request's signal ends it. */
    const hanging: Responder = (_path, init) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
      );

    beforeEach(() => {
      vi.useFakeTimers();
      // The platform's own timeout timer ignores fake timers; this one follows them.
      vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new DOMException('timed out', 'TimeoutError')), ms);
        return controller.signal;
      });
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it('gives up after the start timeout and starts from the copy of the device', async () => {
      const { auth } = setup(hanging, TEST_ME);
      const settled = vi.fn();
      void auth.ready().then(settled);

      await vi.advanceTimersByTimeAsync(START_LOAD_TIMEOUT_MS - 1);
      expect(settled).not.toHaveBeenCalled();
      expect(auth.status()).toBe('unknown');

      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toHaveBeenCalled();
      expect(auth.status()).toBe('offline');
      expect(auth.me()).toEqual(TEST_ME);
    });

    it('without a copy says the connection is lost', async () => {
      const { auth } = setup(hanging);
      void auth.ready();
      await vi.advanceTimersByTimeAsync(START_LOAD_TIMEOUT_MS);
      expect(auth.status()).toBe('signedOut');
      expect(auth.connectionLost()).toBe(true);
    });
  });

  it('asks once while a request is running', async () => {
    const { auth, fetchFn } = setup(() => json(TEST_ME));
    await Promise.all([auth.load(), auth.load()]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('ready() loads once and hands out the same result afterwards', async () => {
    const { auth, fetchFn } = setup(() => json(TEST_ME));
    await Promise.all([auth.ready(), auth.ready()]);
    await auth.ready();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(auth.status()).toBe('signedIn');
  });
});

describe('AuthService coming back online', () => {
  it('loads again when the browser goes from offline to online and replaces the copy', async () => {
    let reachable = false;
    const changed = { ...TEST_ME, displayName: 'Till K.' };
    const { auth, online, cache, fetchFn } = setup(
      () => (reachable ? json(changed) : unreachable()),
      TEST_ME,
    );
    online.set(false);
    TestBed.tick();
    await auth.load();
    expect(auth.status()).toBe('offline');

    reachable = true;
    online.set(true);
    TestBed.tick();
    await vi.waitFor(() => expect(auth.status()).toBe('signedIn'));
    expect(auth.me()).toEqual(changed);
    expect(cache.me).toEqual(changed);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('signs out when the session ended while the device was offline', async () => {
    let answer: () => Response = () => unreachable();
    const { auth, online, cache } = setup(() => answer(), TEST_ME);
    online.set(false);
    TestBed.tick();
    await auth.load();
    answer = () => apiError('auth.required', 401);
    online.set(true);
    TestBed.tick();
    await vi.waitFor(() => expect(auth.status()).toBe('signedOut'));
    expect(cache.me).toBeNull();
  });

  it('also retries after a start that had no connection and no copy', async () => {
    let reachable = false;
    const { auth, online } = setup(() => (reachable ? json(TEST_ME) : unreachable()));
    online.set(false);
    TestBed.tick();
    await auth.load();
    expect(auth.connectionLost()).toBe(true);

    reachable = true;
    online.set(true);
    TestBed.tick();
    await vi.waitFor(() => expect(auth.status()).toBe('signedIn'));
    expect(auth.connectionLost()).toBe(false);
  });

  it('does not load again for a signed-in user who merely goes through an offline phase', async () => {
    const { auth, online, fetchFn } = setup(() => json(TEST_ME));
    await auth.load();
    online.set(false);
    TestBed.tick();
    online.set(true);
    TestBed.tick();
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(auth.status()).toBe('signedIn');
  });
});

describe('AuthService coming back to the page', () => {
  afterEach(() => vi.restoreAllMocks());

  function show(state: DocumentVisibilityState) {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('asks again when the page becomes visible after a server error left it offline', async () => {
    let reachable = false;
    const { auth, fetchFn } = setup(
      () => (reachable ? json(TEST_ME) : apiError('internal', 502)),
      TEST_ME,
    );
    await auth.load();
    expect(auth.status()).toBe('offline');

    reachable = true;
    show('visible');
    await vi.waitFor(() => expect(auth.status()).toBe('signedIn'));
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('asks again after a start without a copy that could not reach the server', async () => {
    let reachable = false;
    const { auth } = setup(() => (reachable ? json(TEST_ME) : apiError('internal', 502)));
    await auth.load();
    expect(auth.connectionLost()).toBe(true);

    reachable = true;
    show('visible');
    await vi.waitFor(() => expect(auth.status()).toBe('signedIn'));
    expect(auth.connectionLost()).toBe(false);
  });

  it('does not ask when the page gets hidden', async () => {
    const { auth, fetchFn } = setup(() => apiError('internal', 502), TEST_ME);
    await auth.load();
    show('hidden');
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not ask for a user who is signed in or signed out', async () => {
    const signedIn = setup(() => json(TEST_ME));
    await signedIn.auth.load();
    show('visible');
    await Promise.resolve();
    expect(signedIn.fetchFn).toHaveBeenCalledTimes(1);
  });

  it('stops listening when the service is destroyed', async () => {
    const { auth, fetchFn } = setup(() => apiError('internal', 502), TEST_ME);
    await auth.load();
    TestBed.resetTestingModule();
    show('visible');
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService.updateMe', () => {
  it('takes over the user from an answer and keeps the copy', async () => {
    const { auth, cache } = setup(() => json(TEST_ME));
    await auth.load();
    const changed = { ...TEST_ME, locale: 'en' as const };
    auth.updateMe(changed);
    expect(auth.me()).toEqual(changed);
    expect(cache.me).toEqual(changed);
  });

  it('refuses an answer that is not a user', async () => {
    const { auth } = setup(() => json(TEST_ME));
    await auth.load();
    expect(() => auth.updateMe({ nope: 1 })).toThrow();
    expect(auth.me()).toEqual(TEST_ME);
  });
});

describe('AuthService.handleUnauthorized', () => {
  async function signedInAt(url: string) {
    const harness = setup(() => json(TEST_ME));
    await harness.auth.load();
    await harness.router.navigateByUrl(url);
    return harness;
  }

  it('deletes the copy, forgets the user and goes to the sign-in page with the current URL', async () => {
    const { auth, cache, router } = await signedInAt('/mehr/einstellungen?x=1');
    auth.handleUnauthorized();
    expect(auth.me()).toBeNull();
    expect(auth.status()).toBe('signedOut');
    expect(cache.me).toBeNull();
    await vi.waitFor(() =>
      expect(router.url).toBe('/anmelden?ziel=%2Fmehr%2Feinstellungen%3Fx%3D1'),
    );
  });

  it('also removes the theme cache so the next person on the device does not get its colors', async () => {
    const { auth, cache } = await signedInAt('/mehr');
    auth.handleUnauthorized();
    expect(cache.themeBootCleared).toBe(true);
  });

  it('omits the target when the user was on the start page', async () => {
    const { auth, router } = await signedInAt('/');
    auth.handleUnauthorized();
    await vi.waitFor(() => expect(router.url).toBe('/anmelden'));
  });

  it('does nothing while the first load is still running (the guard sends the user itself)', async () => {
    const { auth, router } = setup(() => json(TEST_ME));
    const navigate = vi.spyOn(router, 'navigate');
    auth.handleUnauthorized();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does nothing when the user is already signed out', async () => {
    const { auth, router } = setup(() => apiError('auth.required', 401));
    await auth.load();
    const navigate = vi.spyOn(router, 'navigate');
    auth.handleUnauthorized();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('AuthService.requestCode and verifyCode', () => {
  it('requestCode posts the address', async () => {
    const { auth, fetchFn } = setup(() => new Response(null, { status: 204 }));
    await auth.requestCode('till@example.org');
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/v1/auth/email-code',
      expect.objectContaining({ method: 'POST', body: '{"email":"till@example.org"}' }),
    );
  });

  it('verifyCode posts address and code, then signs in and keeps the copy', async () => {
    const { auth, cache, fetchFn } = setup(() => json(TEST_ME));
    await auth.verifyCode('till@example.org', '123456');
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/v1/auth/email-code/verify',
      expect.objectContaining({
        method: 'POST',
        body: '{"email":"till@example.org","code":"123456"}',
      }),
    );
    expect(auth.status()).toBe('signedIn');
    expect(auth.me()).toEqual(TEST_ME);
    expect(cache.me).toEqual(TEST_ME);
  });

  it('lets the error of a wrong code through and stays signed out', async () => {
    const { auth } = setup(() => apiError('auth.invalidCode', 400));
    await expect(auth.verifyCode('till@example.org', '000000')).rejects.toMatchObject({
      code: 'auth.invalidCode',
      status: 400,
    });
    expect(auth.status()).toBe('unknown');
    expect(auth.me()).toBeNull();
  });

  it('refuses an answer that is not a user', async () => {
    const { auth } = setup(() => json({ nope: 1 }));
    await expect(auth.verifyCode('till@example.org', '123456')).rejects.toMatchObject({
      code: 'internal',
    });
    expect(auth.me()).toBeNull();
  });
});

describe('AuthService.logout', () => {
  async function signedIn(respond: Responder = () => json(TEST_ME)) {
    const harness = setup(respond);
    await harness.auth.load();
    await harness.router.navigateByUrl('/mehr');
    return harness;
  }

  it('tells the server, removes the copy and the theme cache and goes to the sign-in page', async () => {
    const { auth, cache, router, fetchFn } = await signedIn((path) =>
      path.endsWith('/logout') ? new Response(null, { status: 204 }) : json(TEST_ME),
    );
    await auth.logout();
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(auth.me()).toBeNull();
    expect(auth.status()).toBe('signedOut');
    expect(cache.me).toBeNull();
    expect(cache.themeBootCleared).toBe(true);
    expect(router.url).toBe('/anmelden');
  });

  it('counts an already ended session as signed out', async () => {
    const { auth, router } = await signedIn((path) =>
      path.endsWith('/logout') ? apiError('auth.required', 401) : json(TEST_ME),
    );
    await auth.logout();
    expect(auth.status()).toBe('signedOut');
    await vi.waitFor(() => expect(router.url).toBe('/anmelden'));
  });

  it('stays signed in and reports the failure when the server cannot be reached', async () => {
    const { auth, cache, router } = await signedIn((path) =>
      path.endsWith('/logout') ? unreachable() : json(TEST_ME),
    );
    await expect(auth.logout()).rejects.toMatchObject({ code: 'internal', status: 0 });
    expect(auth.status()).toBe('signedIn');
    expect(cache.me).toEqual(TEST_ME);
    expect(cache.themeBootCleared).toBe(false);
    expect(router.url).toBe('/mehr');
  });
});
