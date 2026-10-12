import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TRANSLOCO_LOADER, TranslocoService } from '@jsverse/transloco';
import { throwError } from 'rxjs';
import { BROWSER_LANGUAGES, LANGUAGE_STORE } from './language-store';
import { provideI18n } from './provide-i18n';

describe('language preload', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it('has the active language loaded before the app starts rendering', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideI18n(),
        {
          provide: LANGUAGE_STORE,
          useValue: { load: () => null, save: () => undefined, watch: () => () => undefined },
        },
        { provide: BROWSER_LANGUAGES, useValue: ['en-US'] },
      ],
    });
    await TestBed.inject(ApplicationInitStatus).donePromise;

    const translations = TestBed.inject(TranslocoService).getTranslation('en');
    expect(Object.keys(translations).length).toBeGreaterThan(0);
  });

  it('still starts when the translation fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        provideI18n(),
        {
          provide: TRANSLOCO_LOADER,
          useValue: { getTranslation: () => throwError(() => new Error('chunk')) },
        },
        {
          provide: LANGUAGE_STORE,
          useValue: { load: () => null, save: () => undefined, watch: () => () => undefined },
        },
        { provide: BROWSER_LANGUAGES, useValue: ['en-US'] },
      ],
    });
    await expect(TestBed.inject(ApplicationInitStatus).donePromise).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
