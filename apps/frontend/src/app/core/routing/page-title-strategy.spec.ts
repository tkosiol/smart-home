import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, TitleStrategy, provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import de from '../../../i18n/de.json';
import en from '../../../i18n/en.json';
import { PageTitleStrategy } from './page-title-strategy';

@Component({
  template: '<main><h1 tabindex="-1">Seite</h1></main>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Page {}

@Component({
  template: '<main><p>Ohne Überschrift</p></main>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class HeadlessPage {}

/** Its heading appears a moment after the route is active, like a page waiting for its texts. */
@Component({
  template: `<main>
    <button>Weiter</button>
    @if (ready()) {
      <h1 tabindex="-1">Spät</h1>
    }
  </main>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class LatePage {
  protected readonly ready = signal(false);
  constructor() {
    setTimeout(() => this.ready.set(true), 30);
  }
}

const routes: Routes = [
  { path: 'spaet', component: LatePage, title: 'app.title.devices' },
  { path: '', component: Page, title: 'app.title.overview' },
  { path: 'raeume', component: Page, title: 'app.title.rooms' },
  { path: 'ohne-titel', component: Page },
  { path: 'unbekannt', component: Page, title: 'app.title.gibtEsNicht' },
  { path: 'ohne-h1', component: HeadlessPage, title: 'app.title.more' },
];

function setup() {
  TestBed.configureTestingModule({
    providers: [
      importProvidersFrom(
        TranslocoTestingModule.forRoot({
          langs: { de, en },
          translocoConfig: { availableLangs: ['de', 'en'], defaultLang: 'de' },
          preloadLangs: true,
        }),
      ),
      provideRouter(routes),
      { provide: TitleStrategy, useExisting: PageTitleStrategy },
    ],
  });
  return {
    title: TestBed.inject(Title),
    transloco: TestBed.inject(TranslocoService),
  };
}

describe('PageTitleStrategy', () => {
  it('names the page in the document title, followed by the product name', async () => {
    const context = setup();
    const harness = await RouterTestingHarness.create('/raeume');
    expect(context.title.getTitle()).toBe('Räume – Smart Home');
    await harness.navigateByUrl('/');
    expect(context.title.getTitle()).toBe('Übersicht – Smart Home');
  });

  it('follows the language', async () => {
    const { title, transloco } = setup();
    await RouterTestingHarness.create('/raeume');
    transloco.setActiveLang('en');
    expect(title.getTitle()).toBe('Rooms – Smart Home');
    transloco.setActiveLang('de');
    expect(title.getTitle()).toBe('Räume – Smart Home');
  });

  it('shows only the product name without a title or with a key that has no text', async () => {
    const { title } = setup();
    const harness = await RouterTestingHarness.create('/ohne-titel');
    expect(title.getTitle()).toBe('Smart Home');
    await harness.navigateByUrl('/unbekannt');
    expect(title.getTitle()).toBe('Smart Home');
  });

  it('stops following the language of a page that is gone', async () => {
    const { title, transloco } = setup();
    const harness = await RouterTestingHarness.create('/raeume');
    await harness.navigateByUrl('/ohne-titel');
    transloco.setActiveLang('en');
    expect(title.getTitle()).toBe('Smart Home');
  });

  describe('scroll', () => {
    it('starts a new page at the top, but not the first page', async () => {
      setup();
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
      const harness = await RouterTestingHarness.create('/raeume');
      expect(scrollTo).not.toHaveBeenCalled();
      await harness.navigateByUrl('/');
      expect(scrollTo).toHaveBeenCalledExactlyOnceWith(0, 0);
    });

    it('leaves the position of a page to the browser when going back', async () => {
      setup();
      const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
      // Starts the router's listener for the browser's back and forward buttons.
      TestBed.inject(Router).initialNavigation();
      const harness = await RouterTestingHarness.create('/raeume');
      await harness.navigateByUrl('/');
      scrollTo.mockClear();
      TestBed.inject(Location).back();
      await vi.waitFor(() => expect(TestBed.inject(Title).getTitle()).toBe('Räume – Smart Home'));
      expect(scrollTo).not.toHaveBeenCalled();
      await harness.fixture.whenStable();
    });
  });

  describe('focus', () => {
    it('stays where it is on the first page', async () => {
      setup();
      await RouterTestingHarness.create('/raeume');
      expect(document.activeElement).toBe(document.body);
    });

    it('moves to the heading of the page after a navigation', async () => {
      setup();
      const harness = await RouterTestingHarness.create('/raeume');
      await harness.navigateByUrl('/');
      await harness.fixture.whenStable();
      expect(document.activeElement?.tagName).toBe('H1');
    });

    it('waits for a heading that appears after the page is shown', async () => {
      setup();
      const harness = await RouterTestingHarness.create('/raeume');
      await harness.navigateByUrl('/spaet');
      expect(document.activeElement).toBe(document.body);
      await vi.waitFor(() => expect(document.activeElement?.tagName).toBe('H1'));
    });

    it('does not take the focus from where the user moved it meanwhile', async () => {
      setup();
      const harness = await RouterTestingHarness.create('/raeume');
      await harness.navigateByUrl('/spaet');
      const button = harness.routeNativeElement?.querySelector('button');
      button?.focus();
      await new Promise((resolve) => setTimeout(resolve, 80));
      harness.detectChanges();
      expect(harness.routeNativeElement?.querySelector('h1')).not.toBeNull();
      expect(document.activeElement).toBe(button);
    });

    it('leaves the focus alone when the page has no heading', async () => {
      setup();
      const harness = await RouterTestingHarness.create('/raeume');
      await harness.navigateByUrl('/ohne-h1');
      await harness.fixture.whenStable();
      expect(document.activeElement).toBe(document.body);
    });
  });
});
