import { DOCUMENT, importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { Language } from '@smart/contracts';
import { BROWSER_LANGUAGES, LANGUAGE_STORE, type LanguageStore } from './language-store';
import { LanguageService } from './language.service';

class MemoryLanguageStore implements LanguageStore {
  value: Language | null = null;
  load = () => this.value;
  save = (language: Language) => {
    this.value = language;
  };
}

function setup({ stored = null as Language | null, browser = [] as string[] } = {}) {
  const store = new MemoryLanguageStore();
  store.value = stored;
  TestBed.configureTestingModule({
    providers: [
      importProvidersFrom(
        TranslocoTestingModule.forRoot({
          langs: { de: {}, en: {} },
          translocoConfig: { availableLangs: ['de', 'en'], defaultLang: 'de' },
        }),
      ),
      { provide: LANGUAGE_STORE, useValue: store },
      { provide: BROWSER_LANGUAGES, useValue: browser },
    ],
  });
  return {
    service: TestBed.inject(LanguageService),
    store,
    transloco: TestBed.inject(TranslocoService),
    html: TestBed.inject(DOCUMENT).documentElement,
  };
}

describe('LanguageService', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it('starts with the stored language over the browser preference', () => {
    const { service } = setup({ stored: 'en', browser: ['de-DE'] });
    expect(service.language()).toBe('en');
  });

  it('starts with the first supported browser language without a stored choice', () => {
    const { service, transloco, html } = setup({ browser: ['fr-FR', 'en-GB'] });
    expect(service.language()).toBe('en');
    expect(transloco.getActiveLang()).toBe('en');
    expect(html.lang).toBe('en');
  });

  it('falls back to German', () => {
    expect(setup({ browser: ['fr'] }).service.language()).toBe('de');
  });

  it('switches, stores and announces a new language', () => {
    const { service, store, transloco, html } = setup();
    service.setLanguage('en');
    expect(service.language()).toBe('en');
    expect(store.value).toBe('en');
    expect(transloco.getActiveLang()).toBe('en');
    expect(html.lang).toBe('en');
  });

  it('rejects languages the app does not support', () => {
    const { service } = setup();
    expect(() => service.setLanguage('fr' as Language)).toThrow();
    expect(service.language()).toBe('de');
  });
});
