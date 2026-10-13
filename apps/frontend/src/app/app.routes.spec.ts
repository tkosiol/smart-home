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
import { apiError, json, MemoryMeCache, TEST_ME } from './testing/auth-testing';

async function setup(me: () => Response) {
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
      { provide: API_FETCH, useValue: async () => me() },
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
});
