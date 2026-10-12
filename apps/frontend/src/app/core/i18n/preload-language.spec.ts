import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { BROWSER_LANGUAGES, LANGUAGE_STORE } from './language-store';
import { provideI18n } from './provide-i18n';

describe('language preload', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it('has the active language loaded before the app starts rendering', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideI18n(),
        { provide: LANGUAGE_STORE, useValue: { load: () => null, save: () => undefined } },
        { provide: BROWSER_LANGUAGES, useValue: ['en-US'] },
      ],
    });
    await TestBed.inject(ApplicationInitStatus).donePromise;

    const translations = TestBed.inject(TranslocoService).getTranslation('en');
    expect(Object.keys(translations).length).toBeGreaterThan(0);
  });
});
