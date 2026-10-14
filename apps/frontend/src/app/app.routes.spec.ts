import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { API_FETCH } from './core/api';
import { ME_CACHE, signedIn } from './core/auth';
import { hasHousehold } from './core/household';
import { Shell } from './shell';
import { BROWSER_LANGUAGES, LANGUAGE_STORE, provideI18n } from './core/i18n';
import {
  apiError,
  householdOf,
  json,
  MemoryMeCache,
  meWith,
  TEST_ME,
} from './testing/auth-testing';

async function setup(me: (path: string) => Response) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      provideI18n(),
      provideServiceWorker('ngsw-worker.js', { enabled: false }),
      {
        provide: LANGUAGE_STORE,
        useValue: { load: () => null, save: () => undefined, watch: () => () => undefined },
      },
      { provide: BROWSER_LANGUAGES, useValue: ['de-DE'] },
      { provide: API_FETCH, useValue: async (input: RequestInfo | URL) => me(String(input)) },
      { provide: ME_CACHE, useValue: new MemoryMeCache() },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  return { harness: await RouterTestingHarness.create(), router: TestBed.inject(Router) };
}

describe('routes', () => {
  it('lets the shell match only for signed-in users with a household', () => {
    const frame = routes.find((route) => route.component === Shell);
    expect(frame?.canMatch).toEqual([signedIn, hasHousehold]);
  });

  it('puts the device detail page before the device list, inside the shell', () => {
    const paths = routes.find((route) => route.component === Shell)?.children?.map((r) => r.path);
    expect(paths).toContain('geraete/:id');
    expect(paths!.indexOf('geraete/:id')).toBeLessThan(paths!.indexOf('geraete'));
  });

  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it.each([
    ['/raeume', '/anmelden?ziel=%2Fraeume'],
    ['/mehr/einstellungen', '/anmelden?ziel=%2Fmehr%2Feinstellungen'],
    ['/gibt-es-nicht', '/anmelden?ziel=%2Fgibt-es-nicht'],
    ['/', '/anmelden'],
  ])('sends a signed-out user from %s to the sign-in page', async (from, to) => {
    const { harness, router } = await setup(() => apiError('auth.required', 401));
    await harness.navigateByUrl(from);
    expect(router.url).toBe(to);
    await vi.waitFor(() => {
      harness.detectChanges();
      expect(
        (harness.routeNativeElement as HTMLElement).querySelector('h1')?.textContent,
      ).toContain('Anmelden');
    });
    // The sign-in page stands outside the shell.
    expect((harness.routeNativeElement as HTMLElement).querySelector('nav')).toBeNull();
  });

  it('shows the pages inside the shell to a signed-in user and "Nicht gefunden" for the rest', async () => {
    const { harness, router } = await setup(() => json(TEST_ME));
    await harness.navigateByUrl('/raeume');
    expect(router.url).toBe('/raeume');
    expect((harness.routeNativeElement as HTMLElement).tagName.toLowerCase()).toBe('app-shell');
    await harness.navigateByUrl('/gibt-es-nicht');
    expect(router.url).toBe('/gibt-es-nicht');
  });

  describe('households', () => {
    const element = (harness: RouterTestingHarness) => harness.routeNativeElement as HTMLElement;
    const heading = async (harness: RouterTestingHarness, text: string) =>
      vi.waitFor(() => {
        harness.detectChanges();
        expect(element(harness).querySelector('h1')?.textContent).toContain(text);
      });

    it('leads a user without a household to the set-up page, outside the shell', async () => {
      const { harness, router } = await setup(() => json(meWith([])));
      await harness.navigateByUrl('/raeume');
      expect(router.url).toBe('/einrichten');
      await heading(harness, 'Haushalt einrichten');
      expect(element(harness).tagName.toLowerCase()).toBe('app-setup-page');
      expect(element(harness).querySelector('nav')).toBeNull();
    });

    it('keeps the set-up page open for a user who already has a household', async () => {
      const { harness, router } = await setup(() => json(TEST_ME));
      await harness.navigateByUrl('/einrichten');
      expect(router.url).toBe('/einrichten');
      await heading(harness, 'Haushalt einrichten');
    });

    it('sends a signed-out user from the set-up page to the sign-in page', async () => {
      const { harness, router } = await setup(() => apiError('auth.required', 401));
      await harness.navigateByUrl('/einrichten');
      expect(router.url).toBe('/anmelden?ziel=%2Feinrichten');
    });

    it('shows the switch page inside the shell', async () => {
      const { harness, router } = await setup(() => json(TEST_ME));
      await harness.navigateByUrl('/haushalte');
      expect(router.url).toBe('/haushalte');
      expect(element(harness).tagName.toLowerCase()).toBe('app-shell');
      await heading(harness, 'Haushalt wechseln');
    });

    it('shows the household settings to an owner inside the shell', async () => {
      const { harness, router } = await setup(() => json(TEST_ME));
      await harness.navigateByUrl('/mehr/haushalt');
      expect(router.url).toBe('/mehr/haushalt');
      expect(element(harness).tagName.toLowerCase()).toBe('app-shell');
      await heading(harness, 'Haushalt');
    });

    it('shows the members to a viewer inside the shell', async () => {
      const viewer = householdOf('Haus', { role: 'viewer' });
      const { harness, router } = await setup((path) =>
        json(path.endsWith('/members') ? [] : meWith([viewer])),
      );
      await harness.navigateByUrl('/mehr/mitglieder');
      expect(router.url).toBe('/mehr/mitglieder');
      expect(element(harness).tagName.toLowerCase()).toBe('app-shell');
      await heading(harness, 'Mitglieder');
    });

    it('sends everyone else from the household settings to the overview', async () => {
      const member = householdOf('Haus', { role: 'member' });
      const { harness, router } = await setup(() => json(meWith([member])));
      await harness.navigateByUrl('/mehr/haushalt');
      expect(router.url).toBe('/');
    });
  });
});
