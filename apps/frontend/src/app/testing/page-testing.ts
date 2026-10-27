import { ApplicationInitStatus, type Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { Language } from '@smart/contracts';
import { provideUiChartTesting } from '@smart/ui/testing';
import { BROWSER_LANGUAGES, LANGUAGE_STORE, provideI18n } from '../core/i18n';

/**
 * Starts the app's real i18n (lazy scoped texts included) in `language` with the given routes and
 * returns a harness to navigate them. `providers` come last and so can override the defaults.
 */
export async function setupPage(routes: Routes, language: Language, providers: Provider[] = []) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      provideI18n(),
      {
        provide: LANGUAGE_STORE,
        useValue: { load: () => language, save: () => undefined, watch: () => () => undefined },
      },
      { provide: BROWSER_LANGUAGES, useValue: [language] },
      // ui-chart draws nothing in jsdom (ECharts would look for a canvas and complain).
      provideUiChartTesting(),
      ...providers,
    ],
  });
  await TestBed.inject(ApplicationInitStatus).donePromise;
  return RouterTestingHarness.create();
}

/**
 * Waits until the routed page shows its heading: scoped texts load lazily, so the first render of
 * a page has no translated title yet.
 */
export async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    harness.detectChanges();
    if (harness.routeNativeElement?.querySelector('h1')) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('The page did not render a heading');
}
