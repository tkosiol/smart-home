import { ApplicationInitStatus, signal, type Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { UiAnnouncer } from '@smart/ui';
import { routes } from '../app.routes';
import { BROWSER_LANGUAGES, LANGUAGE_STORE, provideI18n } from '../core/i18n';
import { API_FETCH } from '../core/api';
import { AuthService, ME_CACHE } from '../core/auth';
import { AppUpdates, OnlineStatus } from '../core/pwa';
import {
  MemoryMeCache,
  TEST_HOUSEHOLD,
  TEST_ME,
  householdOf,
  meWith,
  signedInProviders,
} from '../testing/auth-testing';
import { Shell } from './shell';

async function setup(extra: Provider[] = signedInProviders()) {
  const online = signal(true);
  const updateReady = signal(false);
  const reload = vi.fn();
  const announce = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      { provide: OnlineStatus, useValue: { online } },
      { provide: AppUpdates, useValue: { updateReady, reload } },
      { provide: UiAnnouncer, useValue: { announce } },
      provideRouter(routes),
      provideI18n(),
      {
        provide: LANGUAGE_STORE,
        useValue: { load: () => null, save: () => undefined, watch: () => () => undefined },
      },
      { provide: BROWSER_LANGUAGES, useValue: ['de-DE'] },
      ...extra,
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  await TestBed.inject(AuthService).load();
  return { online, updateReady, reload, announce };
}

describe('Shell', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it('navigates to the four main destinations with German names', async () => {
    await setup();
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const links = [...element.querySelectorAll('nav a')];
    // The icon glyph is aria-hidden, so the label alone names the link.
    const labels = links.map((a) => a.querySelector('.label')?.textContent?.trim());

    expect(labels).toEqual(['Übersicht', 'Räume', 'Geräte', 'Mehr']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/', '/raeume', '/geraete', '/mehr']);
    expect(element.querySelector('nav')?.getAttribute('aria-label')).toBe('Hauptnavigation');
  });

  it('shows the household name and a bell that links to More', async () => {
    await setup();
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('header')?.textContent).toContain(TEST_HOUSEHOLD.name);
    const bell = element.querySelector('header a') as HTMLAnchorElement;
    expect(bell.getAttribute('aria-label')).toBe('Benachrichtigungen, keine neuen');
    expect(bell.getAttribute('href')).toBe('/mehr');
    expect(element.querySelector('main')).not.toBeNull();
  });

  it('offers no switch button with a single household', async () => {
    await setup();
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('header a')).toHaveLength(1);
  });

  it('shows the current household and a switch button to /haushalte with several', async () => {
    const [home, office] = [householdOf('Zuhause'), householdOf('Büro')];
    await setup(signedInProviders(meWith([home, office], office.id)));
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    const header = (fixture.nativeElement as HTMLElement).querySelector('header') as HTMLElement;

    expect(header.textContent).toContain('Büro');
    const links = [...header.querySelectorAll('a')];
    const swap = links.find((a) => a.getAttribute('aria-label') === 'Haushalt wechseln');
    expect(swap?.getAttribute('href')).toBe('/haushalte');
  });

  it('shows the offline banner only while offline and announces it', async () => {
    const { online, announce } = await setup();
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('ui-banner')).toBeNull();
    expect(announce).not.toHaveBeenCalled();

    online.set(false);
    fixture.detectChanges();
    expect(element.querySelector('ui-banner[data-tone="offline"]')?.textContent).toContain(
      'Offline – Anzeigen können veraltet sein',
    );
    expect(announce).toHaveBeenCalledWith('Offline – Anzeigen können veraltet sein', 'polite');

    online.set(true);
    fixture.detectChanges();
    expect(element.querySelector('ui-banner')).toBeNull();
  });

  it('shows the offline banner when the app started from the device copy although the browser is online', async () => {
    await setup([
      {
        provide: API_FETCH,
        useValue: async () => {
          throw new TypeError('Failed to fetch');
        },
      },
      { provide: ME_CACHE, useValue: new MemoryMeCache(TEST_ME) },
    ]);
    await TestBed.inject(AuthService).load();
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('ui-banner[data-tone="offline"]'),
    ).not.toBeNull();
  });

  it('offers to reload when a new version is ready and announces it', async () => {
    const { updateReady, reload, announce } = await setup();
    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('ui-banner')).toBeNull();

    updateReady.set(true);
    fixture.detectChanges();
    const banner = element.querySelector('ui-banner[data-tone="info"]') as HTMLElement;
    expect(banner.textContent).toContain('Neue Version verfügbar');
    expect(announce).toHaveBeenCalledWith('Neue Version verfügbar', 'polite');

    (banner.querySelector('button') as HTMLButtonElement).click();
    expect(banner.querySelector('button')?.textContent).toContain('Neu laden');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('shows "Nicht gefunden" inside the frame for an unknown route', async () => {
    await setup();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/gibt-es-nicht');
    const element = harness.routeNativeElement as HTMLElement;

    // The page sits inside the frame: the shell is the routed component, the page its child.
    expect(element.tagName.toLowerCase()).toBe('app-shell');
    expect(element.querySelector('nav')).not.toBeNull();
    expect(element.querySelector('main h1')?.textContent).toContain('Nicht gefunden');
    expect(element.querySelector('main a[href="/"]')).not.toBeNull();
  });
});
