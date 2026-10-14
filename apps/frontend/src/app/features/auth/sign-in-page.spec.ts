import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { Language } from '@smart/contracts';
import { UiSnackbar } from '@smart/ui';
import { API_FETCH } from '../../core/api';
import { AuthService, ME_CACHE } from '../../core/auth';
import { OnlineStatus } from '../../core/pwa';
import { apiError, json, MemoryMeCache, TEST_ME } from '../../testing/auth-testing';
import { settle, setupPage } from '../../testing/page-testing';
import { authRoutes } from './auth.routes';

type Responder = (path: string, body: unknown) => Response | Promise<Response>;
const noContent = () => new Response(null, { status: 204 });
const unreachable = () => {
  throw new TypeError('Failed to fetch');
};

/** `GET /me` is 401 until a code was verified; the other calls go to `respond`. */
async function open(
  respond: Responder,
  {
    language = 'de',
    url = '/anmelden',
    cached = null,
  }: { language?: Language; url?: string; cached?: typeof TEST_ME | null } = {},
) {
  const calls: { path: string; body: unknown }[] = [];
  const snackbar = { show: vi.fn().mockResolvedValue(undefined) };
  const online = signal(true);
  const harness = await setupPage(
    [
      { path: 'anmelden', loadChildren: () => authRoutes },
      { path: '**', children: [] },
    ],
    language,
    [
      {
        provide: API_FETCH,
        useValue: async (input: RequestInfo | URL, init?: RequestInit) => {
          const body = init?.body ? JSON.parse(String(init.body)) : undefined;
          calls.push({ path: String(input), body });
          if (String(input) === '/api/v1/me') return apiError('auth.required', 401);
          return respond(String(input), body);
        },
      },
      { provide: ME_CACHE, useValue: new MemoryMeCache(cached) },
      { provide: OnlineStatus, useValue: { online } },
      { provide: UiSnackbar, useValue: snackbar },
    ],
  );
  await harness.navigateByUrl(url);
  await settle(harness);
  const element = harness.routeNativeElement as HTMLElement;
  return {
    harness,
    element,
    calls,
    snackbar,
    router: TestBed.inject(Router),
    auth: TestBed.inject(AuthService),
    online,
  };
}

type Opened = Awaited<ReturnType<typeof open>>;

const text = (element: HTMLElement) => element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const field = (element: HTMLElement) => element.querySelector('input') as HTMLInputElement;
const button = (element: HTMLElement, label: string) =>
  [...element.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(label),
  ) as HTMLButtonElement;

async function type(page: Opened, value: string) {
  const input = field(page.element);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  page.harness.detectChanges();
}

/** Lets pending promises (and, with fake timers, timers due now) run and renders. */
async function flush(page: Opened) {
  for (let round = 0; round < 3; round++) {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((resolve) => setTimeout(resolve, 0));
    page.harness.detectChanges();
  }
}

async function press(page: Opened, label: string) {
  button(page.element, label).click();
  await flush(page);
}

/** Step one done: the code step is showing. */
async function toCodeStep(page: Opened, email = 'Till@Example.org ') {
  await type(page, email);
  await press(page, 'Code senden');
  await vi.waitFor(() =>
    expect(field(page.element).getAttribute('autocomplete')).toBe('one-time-code'),
  );
}

const sendCodeLabel = (language: Language) => (language === 'de' ? 'Code senden' : 'Send code');
const signInLabel = (language: Language) => (language === 'de' ? 'Anmelden' : 'Sign in');

describe('sign-in page', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.setAttribute('lang', 'de');
  });

  describe('step 1: the e-mail address', () => {
    it.each([
      ['de', 'Anmelden', 'E-Mail-Adresse', 'Code senden'],
      ['en', 'Sign in', 'Email address', 'Send code'],
    ] as const)('asks for the address in %s', async (language, title, label, submit) => {
      const { element } = await open(() => noContent(), { language });
      expect(element.querySelector('main h1')?.textContent?.trim()).toBe(title);
      const input = field(element);
      expect(input.type).toBe('email');
      expect(input.getAttribute('autocomplete')).toBe('email');
      expect(element.querySelector('label')?.textContent).toContain(label);
      expect(button(element, submit)).toBeTruthy();
    });

    it('sends the normalized address and moves on to the code step', async () => {
      const page = await open(() => noContent());
      await type(page, ' Till@Example.org ');
      await press(page, 'Code senden');
      expect(page.calls.at(-1)).toEqual({
        path: '/api/v1/auth/email-code',
        body: { email: 'till@example.org' },
      });
      await vi.waitFor(() => expect(text(page.element)).toContain('Code (6 Ziffern)'));
      // Neutral wording: the page does not say whether an account exists.
      expect(text(page.element)).toContain(
        'Wenn zu till@example.org ein Konto gehört, haben wir einen Code geschickt.',
      );
    });

    it.each([
      ['de', 'Bitte gib eine gültige E-Mail-Adresse ein.'],
      ['en', 'Please enter a valid email address.'],
    ] as const)(
      'names an invalid address at the field in %s without asking the server',
      async (language, message) => {
        const page = await open(() => noContent(), { language });
        await type(page, 'not-an-address');
        await press(page, sendCodeLabel(language));
        expect(text(page.element)).toContain(message);
        expect(page.element.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
        expect(page.calls.filter((c) => c.path.includes('email-code'))).toEqual([]);
      },
    );

    it.each([
      ['de', 'Zu viele Anfragen. Bitte versuche es in 120 Sekunden noch einmal.'],
      ['en', 'Too many requests. Please try again in 120 seconds.'],
    ] as const)('names the wait of a rate limit with seconds in %s', async (language, message) => {
      const page = await open(() => apiError('auth.rateLimited', 429, { retryAfterSeconds: 120 }), {
        language,
      });
      await type(page, 'till@example.org');
      await press(page, sendCodeLabel(language));
      expect(text(page.element)).toContain(message);
    });

    it('names a rate limit without a wait time generally', async () => {
      const page = await open(() => apiError('auth.rateLimited', 429));
      await type(page, 'till@example.org');
      await press(page, 'Code senden');
      expect(text(page.element)).toContain(
        'Zu viele Anfragen. Bitte versuche es später noch einmal.',
      );
    });

    it.each([
      ['de', 'nicht eingerichtet'],
      ['en', 'not set up'],
    ] as const)(
      'shows a notice instead of the form when mail is switched off (%s)',
      async (language, fragment) => {
        const page = await open(() => apiError('auth.mailDisabled', 503), { language });
        await type(page, 'till@example.org');
        await press(page, sendCodeLabel(language));
        expect(text(page.element)).toContain(fragment);
        expect(page.element.querySelector('input')).toBeNull();
        expect(page.element.querySelector('form')).toBeNull();
      },
    );

    it('shows other failures as a snackbar and stays on the step', async () => {
      const page = await open(() => apiError('internal', 500));
      await type(page, 'till@example.org');
      await press(page, 'Code senden');
      expect(page.snackbar.show).toHaveBeenCalledWith(
        'Etwas ist schiefgegangen. Bitte versuche es später noch einmal.',
        expect.anything(),
      );
      expect(field(page.element).getAttribute('autocomplete')).toBe('email');
    });
  });

  describe('step 2: the code', () => {
    it.each([
      ['de', 'Code (6 Ziffern)', 'Anmelden', 'Neuen Code senden', 'Andere E-Mail-Adresse'],
      ['en', 'Code (6 digits)', 'Sign in', 'Send a new code', 'Different email address'],
    ] as const)(
      'offers one numeric field and the actions in %s',
      async (language, label, submit, resend, other) => {
        const page = await open(() => noContent(), { language });
        await type(page, 'till@example.org');
        await press(page, sendCodeLabel(language));
        await vi.waitFor(() =>
          expect(field(page.element).getAttribute('autocomplete')).toBe('one-time-code'),
        );
        const input = field(page.element);
        expect(input.getAttribute('inputmode')).toBe('numeric');
        expect(page.element.querySelectorAll('input')).toHaveLength(1);
        expect(page.element.querySelector('label')?.textContent).toContain(label);
        expect(button(page.element, submit)).toBeTruthy();
        expect(button(page.element, resend)).toBeTruthy();
        expect(button(page.element, other)).toBeTruthy();
        // The user can type at once.
        await vi.waitFor(() => expect(document.activeElement).toBe(input));
      },
    );

    it('signs in with the code and leads to the page the user wanted', async () => {
      const page = await open((path) => (path.endsWith('/verify') ? json(TEST_ME) : noContent()), {
        url: '/anmelden?ziel=%2Fmehr%2Feinstellungen',
      });
      await toCodeStep(page);
      await type(page, '123 456');
      await press(page, 'Anmelden');
      expect(page.calls.at(-1)).toEqual({
        path: '/api/v1/auth/email-code/verify',
        body: { email: 'till@example.org', code: '123456' },
      });
      await vi.waitFor(() => expect(page.router.url).toBe('/mehr/einstellungen'));
      expect(page.auth.status()).toBe('signedIn');
    });

    it.each([['//evil.example'], ['https://evil.example/'], ['/\\evil.example'], ['/anmelden']])(
      'leads to the start page instead of the target %s',
      async (target) => {
        const page = await open(
          (path) => (path.endsWith('/verify') ? json(TEST_ME) : noContent()),
          { url: `/anmelden?ziel=${encodeURIComponent(target)}` },
        );
        await toCodeStep(page);
        await type(page, '123456');
        await press(page, 'Anmelden');
        await vi.waitFor(() => expect(page.router.url).toBe('/'));
      },
    );

    it.each([
      ['de', 'Bitte gib die 6 Ziffern aus der E-Mail ein.'],
      ['en', 'Please enter the 6 digits from the email.'],
    ] as const)(
      'asks for six digits at the field in %s without asking the server',
      async (language, message) => {
        const page = await open(() => noContent(), { language });
        await type(page, 'till@example.org');
        await press(page, sendCodeLabel(language));
        await vi.waitFor(() =>
          expect(field(page.element).getAttribute('autocomplete')).toBe('one-time-code'),
        );
        await type(page, '12345');
        await press(page, signInLabel(language));
        expect(text(page.element)).toContain(message);
        expect(page.calls.filter((c) => c.path.endsWith('/verify'))).toEqual([]);
      },
    );

    it.each([
      ['de', 'invalidCode', 400, 'Code falsch oder abgelaufen.'],
      ['en', 'invalidCode', 400, 'Code wrong or expired.'],
      ['de', 'tooManyAttempts', 429, 'Zu viele Versuche. Bitte fordere einen neuen Code an.'],
      ['en', 'tooManyAttempts', 429, 'Too many attempts. Please request a new code.'],
    ] as const)('shows %s/%s at the field', async (language, kind, status, message) => {
      const page = await open(
        (path) => (path.endsWith('/verify') ? apiError(`auth.${kind}`, status) : noContent()),
        { language },
      );
      await type(page, 'till@example.org');
      await press(page, sendCodeLabel(language));
      await vi.waitFor(() =>
        expect(field(page.element).getAttribute('autocomplete')).toBe('one-time-code'),
      );
      await type(page, '000000');
      await press(page, signInLabel(language));
      expect(text(page.element)).toContain(message);
      expect(field(page.element).getAttribute('aria-invalid')).toBe('true');
      expect(page.auth.status()).not.toBe('signedIn');
    });

    it('frees the new-code button at once when the attempts are used up', async () => {
      const page = await open((path) =>
        path.endsWith('/verify') ? apiError('auth.tooManyAttempts', 429) : noContent(),
      );
      await toCodeStep(page);
      expect(button(page.element, 'Neuen Code senden').disabled).toBe(true);
      await type(page, '000000');
      await press(page, 'Anmelden');
      expect(button(page.element, 'Neuen Code senden').disabled).toBe(false);
    });

    it('shows other failures as a snackbar', async () => {
      const page = await open((path) => (path.endsWith('/verify') ? unreachable() : noContent()));
      await toCodeStep(page);
      await type(page, '123456');
      await press(page, 'Anmelden');
      expect(page.snackbar.show).toHaveBeenCalledWith(
        'Etwas ist schiefgegangen. Bitte versuche es später noch einmal.',
        expect.anything(),
      );
    });

    it('goes back to the address with "Andere E-Mail-Adresse"', async () => {
      const page = await open(() => noContent());
      await toCodeStep(page);
      await press(page, 'Andere E-Mail-Adresse');
      expect(field(page.element).getAttribute('autocomplete')).toBe('email');
      expect(field(page.element).value).toBe('Till@Example.org');
    });

    it('lets the user ask for a new code only after 60 seconds', async () => {
      const page = await open(() => noContent());
      // The wait starts when the first code was requested, so the clock is faked before that.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await toCodeStep(page);

      const resend = () => button(page.element, 'Neuen Code senden');
      expect(resend().disabled).toBe(true);
      expect(text(page.element)).toContain(
        'Einen neuen Code kannst du nach einer Minute anfordern.',
      );

      await vi.advanceTimersByTimeAsync(59_000);
      page.harness.detectChanges();
      expect(resend().disabled).toBe(true);

      await vi.advanceTimersByTimeAsync(1_000);
      page.harness.detectChanges();
      expect(resend().disabled).toBe(false);
      expect(text(page.element)).not.toContain('Einen neuen Code kannst du nach einer Minute');

      await press(page, 'Neuen Code senden');
      expect(page.calls.filter((c) => c.path === '/api/v1/auth/email-code')).toHaveLength(2);
      expect(page.calls.at(-1)?.body).toEqual({ email: 'till@example.org' });
      expect(text(page.element)).toContain('Wir haben einen neuen Code geschickt');
      // The wait starts again.
      expect(resend().disabled).toBe(true);
    });
  });

  describe('around the form', () => {
    it('says "Keine Verbindung" when the server could not be reached and nothing is known', async () => {
      const harness = await setupPage(
        [{ path: 'anmelden', loadChildren: () => authRoutes }],
        'de',
        [
          { provide: API_FETCH, useValue: async () => unreachable() },
          { provide: ME_CACHE, useValue: new MemoryMeCache() },
        ],
      );
      await harness.navigateByUrl('/anmelden');
      await settle(harness);
      const element = harness.routeNativeElement as HTMLElement;
      await vi.waitFor(() => {
        harness.detectChanges();
        expect(text(element)).toContain('Keine Verbindung.');
      });
      expect(element.querySelector('ui-banner[data-tone="offline"]')).not.toBeNull();
      expect(element.querySelector('input')).not.toBeNull();
    });

    it('leaves for the target when the user is signed in already', async () => {
      const harness = await setupPage(
        [
          { path: 'anmelden', loadChildren: () => authRoutes },
          { path: '**', children: [] },
        ],
        'de',
        [
          { provide: API_FETCH, useValue: async () => json(TEST_ME) },
          { provide: ME_CACHE, useValue: new MemoryMeCache() },
        ],
      );
      await harness.navigateByUrl('/anmelden?ziel=%2Fraeume');
      const router = TestBed.inject(Router);
      await vi.waitFor(() => expect(router.url).toBe('/raeume'));
    });
  });
});
