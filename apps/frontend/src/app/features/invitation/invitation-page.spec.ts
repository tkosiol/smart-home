import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import type { Language, Me } from '@smart/contracts';
import { UiSnackbar } from '@smart/ui';
import { API_FETCH } from '../../core/api';
import { AuthService, ME_CACHE, safeTarget } from '../../core/auth';
import { OnlineStatus } from '../../core/pwa';
import {
  apiError,
  householdOf,
  json,
  MemoryMeCache,
  meWith,
  TEST_ME,
} from '../../testing/auth-testing';
import { settle, setupPage } from '../../testing/page-testing';
import { INVITATION_STORAGE } from './invitation-token';
import { invitationRoutes } from './invitation.routes';

const TOKEN = 'tok-3fA9_secret-value';
const PREVIEW = {
  householdName: 'Haus Sonnenweg',
  role: 'member',
  email: 'anna@example.org',
  invitedByName: 'Till',
  accountExists: false,
};
const JOINED = meWith([householdOf('Sonnenweg', { role: 'member' })]);

/**
 * Stands in for the sign-in page (a feature does not import another): a click signs in and
 * follows `ziel` like the real page does. The real page is tested with the `ziel` handling.
 */
@Component({
  selector: 'app-sign-in-stand-in',
  template: `<main>
    <h1>Sign-in</h1>
    <button type="button" (click)="signIn()">Verify</button>
  </main>`,
})
class SignInStandIn {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  async signIn(): Promise<void> {
    await this.auth.verifyCode('anna@example.org', '123456');
    await this.router.navigateByUrl(safeTarget(this.route.snapshot.queryParamMap.get('ziel')));
  }
}

interface Call {
  method: string;
  path: string;
  body: unknown;
  init: RequestInit;
}
type Responder = (call: Call) => Response | Promise<Response>;

/** A `sessionStorage` that lives in memory, so the tests see what the page keeps in it. */
class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem = (key: string) => this.values.get(key) ?? null;
  setItem = (key: string, value: string) => void this.values.set(key, value);
  removeItem = (key: string) => void this.values.delete(key);
}

/** Lets pending promises run and renders. */
async function flushPage(harness: { detectChanges: () => void }) {
  for (let round = 0; round < 4; round++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.detectChanges();
  }
}

/**
 * Opens `url` with the invitation page, the sign-in page beside it. `GET /me` answers 401 until a
 * code was verified or, with `signedIn`, always with that user; the rest goes to `respond`.
 */
async function open(
  respond: Responder,
  {
    url = `/einladung/${TOKEN}`,
    language = 'de',
    signedIn = null,
    stored = null,
  }: { url?: string; language?: Language; signedIn?: Me | null; stored?: string | null } = {},
) {
  const calls: Call[] = [];
  const storage = new MemoryStorage();
  if (stored) storage.setItem('smart.invitation', stored);
  const state: { me: Me | null } = { me: signedIn };
  const snackbar = { show: vi.fn().mockResolvedValue(undefined) };
  const harness = await setupPage(
    [
      { path: 'einladung', loadChildren: () => invitationRoutes },
      { path: 'anmelden', component: SignInStandIn },
      { path: '**', children: [] },
    ],
    language,
    [
      {
        provide: API_FETCH,
        useValue: async (input: RequestInfo | URL, init: RequestInit = {}) => {
          const call = {
            method: init.method ?? 'GET',
            path: String(input),
            body: init.body ? JSON.parse(String(init.body)) : undefined,
            init,
          };
          calls.push(call);
          if (call.path === '/api/v1/me') {
            return state.me ? json(state.me) : apiError('auth.required', 401);
          }
          if (call.path === '/api/v1/auth/logout') {
            state.me = null;
            return new Response(null, { status: 204 });
          }
          if (call.path === '/api/v1/auth/email-code/verify') {
            state.me = TEST_ME;
            return json(TEST_ME);
          }
          return respond(call);
        },
      },
      { provide: ME_CACHE, useValue: new MemoryMeCache() },
      { provide: OnlineStatus, useValue: { online: () => true } },
      { provide: UiSnackbar, useValue: snackbar },
      { provide: INVITATION_STORAGE, useValue: storage },
    ],
  );
  await harness.navigateByUrl(url);
  await settle(harness);
  await flushPage(harness);
  const page = {
    harness,
    calls,
    storage,
    state,
    snackbar,
    router: TestBed.inject(Router),
    auth: TestBed.inject(AuthService),
    get element() {
      return harness.routeNativeElement as HTMLElement;
    },
  };
  return page;
}

type Opened = Awaited<ReturnType<typeof open>>;

const text = (page: Opened) => page.element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const control = (page: Opened, label: string) =>
  [...page.element.querySelectorAll('button, a')].find((candidate) =>
    candidate.textContent?.includes(label),
  ) as HTMLButtonElement | HTMLAnchorElement | undefined;
const stored = (page: Opened) => page.storage.getItem('smart.invitation');
const posts = (page: Opened, path: string) =>
  page.calls.filter(
    (call) => call.method === 'POST' && call.path === `/api/v1/invitations/${path}`,
  );

async function press(page: Opened, label: string) {
  const target = control(page, label);
  if (!target) throw new Error(`No control "${label}" in: ${text(page)}`);
  target.click();
  await flushPage(page.harness);
}

function typeName(page: Opened, value: string) {
  const input = page.element.querySelector<HTMLInputElement>('ui-text-field input')!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  page.harness.detectChanges();
}

/** The invitation answers `preview` with `body`; accept and accept-new with `JOINED` unless given. */
const answers =
  (preview: unknown = PREVIEW, rest: Responder = () => json(JOINED)): Responder =>
  (call) =>
    call.path === '/api/v1/invitations/preview' ? json(preview) : rest(call);

describe('invitation page', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  describe('the token', () => {
    it('leaves the address bar at once and goes to the server in the body only', async () => {
      const page = await open(answers());
      expect(page.router.url).toBe('/einladung');
      expect(posts(page, 'preview')).toHaveLength(1);
      expect(posts(page, 'preview')[0].body).toEqual({ token: TOKEN });
      for (const call of page.calls) expect(call.path).not.toContain(TOKEN);
      expect(document.title).not.toContain(TOKEN);
    });

    it('asks for no referrer on every request that carries it', async () => {
      const page = await open(answers(), { signedIn: TEST_ME });
      await press(page, 'Annehmen');
      expect(posts(page, 'preview')[0].init.referrerPolicy).toBe('no-referrer');
      expect(posts(page, 'accept')[0].init.referrerPolicy).toBe('no-referrer');
    });

    it('keeps the token for the sign-in round trip in sessionStorage under one key', async () => {
      const page = await open(answers());
      expect([...page.storage.values.entries()]).toEqual([['smart.invitation', TOKEN]]);
    });

    it('shows the invalid hint, without a form, when a reload brings no token', async () => {
      const page = await open(answers(), { url: '/einladung' });
      expect(text(page)).toContain('Einladung ungültig oder abgelaufen');
      expect(page.element.querySelector('form, input')).toBeNull();
      expect(page.calls.filter((call) => call.path.includes('invitations'))).toEqual([]);
    });

    it('treats a token of unusable length as invalid without asking the server', async () => {
      const page = await open(answers(), { url: `/einladung/${'x'.repeat(101)}` });
      expect(text(page)).toContain('Einladung ungültig oder abgelaufen');
      expect(page.calls.filter((call) => call.path.includes('invitations'))).toEqual([]);
      expect(stored(page)).toBeNull();
    });
  });

  describe('invalid invitation', () => {
    it.each([
      ['de', 'Einladung ungültig oder abgelaufen', 'Zur Anmeldung'],
      ['en', 'Invitation invalid or expired', 'To sign in'],
    ] as const)(
      'shows the hint and a link to sign in in %s, no form',
      async (language, hint, link) => {
        const page = await open(() => apiError('invitation.invalid', 404), { language });
        expect(text(page)).toContain(hint);
        expect(page.element.querySelector('form, input')).toBeNull();
        expect(control(page, link)?.getAttribute('href')).toBe('/anmelden');
      },
    );

    it('forgets the token', async () => {
      const page = await open(() => apiError('invitation.invalid', 404));
      expect(stored(page)).toBeNull();
    });

    it('treats a malformed token (400) like an invalid one', async () => {
      const page = await open(() => apiError('validation.failed', 400));
      expect(text(page)).toContain('Einladung ungültig oder abgelaufen');
      expect(stored(page)).toBeNull();
    });
  });

  describe('a failing server', () => {
    it('says so, keeps the token and offers to try again', async () => {
      let fail = true;
      const page = await open((call) =>
        fail && call.path.endsWith('/preview') ? apiError('internal', 500) : json(PREVIEW),
      );
      expect(text(page)).toContain('Die Einladung konnte nicht geladen werden.');
      expect(stored(page)).toBe(TOKEN);
      fail = false;
      await press(page, 'Erneut versuchen');
      expect(text(page)).toContain(
        'Du wurdest von Till in Haus Sonnenweg als Mitglied eingeladen.',
      );
    });
  });

  describe('signed in', () => {
    const open_ = (respond: Responder = answers(), options: { language?: Language } = {}) =>
      open(respond, { signedIn: TEST_ME, ...options });

    it.each([
      ['de', 'Du wurdest von Till in Haus Sonnenweg als Mitglied eingeladen.', 'Annehmen'],
      ['en', 'Till invited you to Haus Sonnenweg as Member.', 'Accept'],
    ] as const)('says who invited to what in %s', async (language, summary, accept) => {
      const page = await open_(answers(), { language });
      expect(page.element.querySelector('main h1')?.textContent?.trim()).toBe(
        language === 'de' ? 'Einladung' : 'Invitation',
      );
      expect(text(page)).toContain(summary);
      expect(control(page, accept)).toBeTruthy();
      expect(page.element.querySelector('input')).toBeNull();
    });

    it.each([
      ['viewer', 'Betrachter'],
      ['member', 'Mitglied'],
      ['owner', 'Eigentümer'],
    ])('names the role %s as %s', async (role, name) => {
      const page = await open_(answers({ ...PREVIEW, role }));
      expect(text(page)).toContain(`als ${name} eingeladen`);
    });

    it('accepts, takes over the answered user, forgets the token and goes to the start page', async () => {
      const page = await open_();
      await press(page, 'Annehmen');
      expect(posts(page, 'accept')[0].body).toEqual({ token: TOKEN });
      expect(page.auth.me()).toEqual(JOINED);
      expect(stored(page)).toBeNull();
      await vi.waitFor(() => expect(page.router.url).toBe('/'));
    });

    it('explains an address mismatch and offers to sign out and sign in with the right one', async () => {
      const page = await open_(answers(PREVIEW, () => apiError('invitation.emailMismatch', 403)));
      await press(page, 'Annehmen');
      expect(text(page)).toContain('anna@example.org');
      expect(text(page)).toContain('gehört zu einer anderen E-Mail-Adresse');
      expect(stored(page)).toBe(TOKEN);

      await press(page, 'Abmelden und mit dieser Adresse anmelden');
      expect(page.calls.some((call) => call.path === '/api/v1/auth/logout')).toBe(true);
      await vi.waitFor(() => expect(page.router.url).toBe('/anmelden?ziel=%2Feinladung'));
      expect(stored(page)).toBe(TOKEN);
    });

    it('treats an invitation that is gone at accept time as invalid', async () => {
      const page = await open_(answers(PREVIEW, () => apiError('invitation.invalid', 404)));
      await press(page, 'Annehmen');
      expect(text(page)).toContain('Einladung ungültig oder abgelaufen');
      expect(page.element.querySelector('form, input')).toBeNull();
      expect(stored(page)).toBeNull();
    });

    it('shows other failures as a snackbar and stays', async () => {
      const page = await open_(answers(PREVIEW, () => apiError('internal', 500)));
      await press(page, 'Annehmen');
      expect(page.snackbar.show).toHaveBeenCalled();
      expect(control(page, 'Annehmen')).toBeTruthy();
      expect(stored(page)).toBe(TOKEN);
    });
  });

  describe('signed out, with an account', () => {
    const withAccount = { ...PREVIEW, accountExists: true };

    it.each([
      ['de', 'Melde dich mit anna@example.org an.', 'Anmelden'],
      ['en', 'Sign in with anna@example.org.', 'Sign in'],
    ] as const)(
      'asks to sign in with the invited address in %s',
      async (language, hint, button) => {
        const page = await open(answers(withAccount), { language });
        expect(text(page)).toContain(hint);
        expect(page.element.querySelector('input')).toBeNull();
        expect(control(page, button)).toBeTruthy();
      },
    );

    it('leads to the sign-in page with the invitation as target and keeps the token', async () => {
      const page = await open(answers(withAccount));
      await press(page, 'Anmelden');
      await vi.waitFor(() => expect(page.router.url).toBe('/anmelden?ziel=%2Feinladung'));
      expect(stored(page)).toBe(TOKEN);
    });

    it('comes back to the invitation after signing in and offers to accept it', async () => {
      const page = await open(answers(withAccount, () => json(JOINED)));
      await press(page, 'Anmelden');
      await vi.waitFor(() => expect(page.router.url).toBe('/anmelden?ziel=%2Feinladung'));
      await press(page, 'Verify');

      await vi.waitFor(() => expect(page.router.url).toBe('/einladung'));
      await vi.waitFor(() => expect(control(page, 'Annehmen')).toBeTruthy());
      expect(posts(page, 'preview').length).toBeGreaterThanOrEqual(2);
      expect(posts(page, 'preview').at(-1)?.body).toEqual({ token: TOKEN });
      expect(text(page)).toContain(
        'Du wurdest von Till in Haus Sonnenweg als Mitglied eingeladen.',
      );
    });
  });

  describe('signed out, without an account', () => {
    it.each([
      ['de', 'Dein Name', 'Annehmen'],
      ['en', 'Your name', 'Accept'],
    ] as const)('asks for the name in %s', async (language, label, accept) => {
      const page = await open(answers(), { language });
      expect(page.element.querySelector('label')?.textContent).toContain(label);
      expect(control(page, accept)).toBeTruthy();
    });

    it.each([
      ['de', 'de'],
      ['en', 'en'],
    ] as const)(
      'creates the account with the active language (%s) and signs in',
      async (language, locale) => {
        const page = await open(answers(), { language });
        typeName(page, '  Anna ');
        await press(page, language === 'de' ? 'Annehmen' : 'Accept');
        expect(posts(page, 'accept-new')[0].body).toEqual({
          token: TOKEN,
          displayName: 'Anna',
          locale,
        });
        expect(posts(page, 'accept-new')[0].init.referrerPolicy).toBe('no-referrer');
        // Signed in and a member of the household afterwards.
        expect(page.auth.status()).toBe('signedIn');
        expect(page.auth.me()?.households.map((household) => household.name)).toEqual([
          'Sonnenweg',
        ]);
        expect(stored(page)).toBeNull();
        await vi.waitFor(() => expect(page.router.url).toBe('/'));
      },
    );

    it('names an empty or too long name at the field without asking the server', async () => {
      const page = await open(answers());
      typeName(page, '   ');
      await press(page, 'Annehmen');
      expect(text(page)).toContain('Bitte gib einen Namen mit höchstens 60 Zeichen ein.');
      expect(page.element.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
      typeName(page, 'x'.repeat(61));
      await press(page, 'Annehmen');
      expect(posts(page, 'accept-new')).toEqual([]);
    });

    it('switches to the sign-in hint when an account turns out to exist (409)', async () => {
      const page = await open(answers(PREVIEW, () => apiError('invitation.accountExists', 409)));
      typeName(page, 'Anna');
      await press(page, 'Annehmen');
      expect(text(page)).toContain('Melde dich mit anna@example.org an.');
      expect(page.element.querySelector('input')).toBeNull();
      expect(stored(page)).toBe(TOKEN);
    });

    it('treats an invitation that is gone as invalid', async () => {
      const page = await open(answers(PREVIEW, () => apiError('invitation.invalid', 404)));
      typeName(page, 'Anna');
      await press(page, 'Annehmen');
      expect(text(page)).toContain('Einladung ungültig oder abgelaufen');
      expect(stored(page)).toBeNull();
    });
  });

  it('picks the token up from storage after the sign-in round trip', async () => {
    const page = await open(answers(), { url: '/einladung', stored: TOKEN, signedIn: TEST_ME });
    expect(posts(page, 'preview')[0].body).toEqual({ token: TOKEN });
    expect(text(page)).toContain('Du wurdest von Till');
  });
});
