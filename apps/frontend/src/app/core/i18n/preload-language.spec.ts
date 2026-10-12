import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TRANSLOCO_LOADER, TranslocoService, type Translation } from '@jsverse/transloco';
import { BROWSER_LANGUAGES, LANGUAGE_STORE } from './language-store';
import { provideI18n } from './provide-i18n';

const FIXTURES: Record<string, Translation> = {
  en: { greeting: 'Hello' },
  de: { greeting: 'Hallo' },
};

/** A loader that answers only after `release()`, so the test controls when loading ends. */
function gatedLoader() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  return { release, getTranslation: (lang: string) => gate.then(() => FIXTURES[lang]) };
}

const store = {
  provide: LANGUAGE_STORE,
  useValue: { load: () => null, save: () => undefined, watch: () => () => undefined },
};

describe('language preload', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it('has the active language loaded before the app starts rendering', async () => {
    const loader = gatedLoader();
    TestBed.configureTestingModule({
      providers: [
        provideI18n(),
        { provide: TRANSLOCO_LOADER, useValue: loader },
        store,
        { provide: BROWSER_LANGUAGES, useValue: ['en-US'] },
      ],
    });
    let started = false;
    const done = TestBed.inject(ApplicationInitStatus).donePromise.then(() => (started = true));

    await new Promise((resolve) => setTimeout(resolve));
    expect(started).toBe(false);

    loader.release();
    await done;

    const transloco = TestBed.inject(TranslocoService);
    expect(transloco.getTranslation('en')).toEqual(FIXTURES['en']);
    expect(transloco.getActiveLang()).toBe('en');
  });

  it('still starts when the translation fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideI18n(),
        {
          provide: TRANSLOCO_LOADER,
          useValue: { getTranslation: () => Promise.reject(new Error('chunk')) },
        },
        store,
        { provide: BROWSER_LANGUAGES, useValue: ['en-US'] },
      ],
    });
    await expect(TestBed.inject(ApplicationInitStatus).donePromise).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
