import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from '../app.routes';
import { BROWSER_LANGUAGES, LANGUAGE_STORE, provideI18n } from '../core/i18n';
import { Shell } from './shell';

async function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      provideI18n(),
      { provide: LANGUAGE_STORE, useValue: { load: () => null, save: () => undefined } },
      { provide: BROWSER_LANGUAGES, useValue: ['de-DE'] },
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
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

    expect(element.querySelector('header')?.textContent).toContain('Mein Zuhause');
    const bell = element.querySelector('header a') as HTMLAnchorElement;
    expect(bell.getAttribute('aria-label')).toBe('Benachrichtigungen, keine neuen');
    expect(bell.getAttribute('href')).toBe('/mehr');
    expect(element.querySelector('main')).not.toBeNull();
  });

  it('shows "Nicht gefunden" for an unknown route', async () => {
    await setup();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/gibt-es-nicht');
    const element = harness.routeNativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toContain('Nicht gefunden');
    expect(element.querySelector('a[href="/"]')).not.toBeNull();
  });
});
