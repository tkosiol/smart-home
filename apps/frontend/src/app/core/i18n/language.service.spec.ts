import { DOCUMENT, importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { Language } from '@smart/contracts';
import { UiFormatContext } from '@smart/ui';
import {
  BROWSER_LANGUAGES,
  LANGUAGE_STORE,
  LocalStorageLanguageStore,
  type LanguageStore,
} from './language-store';
import { LanguageService } from './language.service';

class MemoryLanguageStore implements LanguageStore {
  value: Language | null = null;
  saves = 0;
  private listeners = new Set<() => void>();
  load = () => this.value;
  save = (language: Language) => {
    this.value = language;
    this.saves++;
  };
  watch = (callback: () => void) => {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  };
  /** Another tab stored `language`. */
  storedElsewhere(language: Language | null) {
    this.value = language;
    this.listeners.forEach((listener) => listener());
  }
  get watchers() {
    return this.listeners.size;
  }
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
    formatContext: TestBed.inject(UiFormatContext),
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

  it('formats dates and numbers in the UI language, from the start and after a switch', () => {
    const { service, formatContext } = setup({ browser: ['en-GB'] });
    expect(formatContext.locale()).toBe('en');
    service.setLanguage('de');
    expect(formatContext.locale()).toBe('de');
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

  describe('language chosen in another tab', () => {
    it('takes over the new language without storing it again', () => {
      const { service, store, transloco, html, formatContext } = setup({ stored: 'de' });
      store.storedElsewhere('en');
      expect(service.language()).toBe('en');
      expect(transloco.getActiveLang()).toBe('en');
      expect(html.lang).toBe('en');
      expect(formatContext.locale()).toBe('en');
      expect(store.saves).toBe(0);
    });

    it('keeps the language when the storage was cleared', () => {
      const { service, store } = setup({ stored: 'en' });
      store.storedElsewhere(null);
      expect(service.language()).toBe('en');
    });

    it('stops watching when the service is destroyed', () => {
      const { store } = setup();
      expect(store.watchers).toBe(1);
      TestBed.resetTestingModule();
      expect(store.watchers).toBe(0);
    });

    it('does not fail on a blocked storage and keeps the session language', () => {
      const blocked = {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {
          throw new Error('SecurityError');
        },
      };
      TestBed.configureTestingModule({
        providers: [
          importProvidersFrom(
            TranslocoTestingModule.forRoot({
              langs: { de: {}, en: {} },
              translocoConfig: { availableLangs: ['de', 'en'], defaultLang: 'de' },
            }),
          ),
          { provide: LANGUAGE_STORE, useValue: new LocalStorageLanguageStore(blocked) },
          { provide: BROWSER_LANGUAGES, useValue: [] },
        ],
      });
      const service = TestBed.inject(LanguageService);
      service.setLanguage('en');
      expect(() =>
        window.dispatchEvent(new StorageEvent('storage', { key: 'smart.language' })),
      ).not.toThrow();
      expect(service.language()).toBe('en');
    });
  });
});
