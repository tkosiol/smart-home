import { TestBed } from '@angular/core/testing';
import { DEFAULT_PERSONAL_APPEARANCE, DEFAULT_RUNTIME_CONFIG } from '@smart/contracts';
import { APPEARANCE_STORE, MemoryAppearanceStore, ThemeService } from '@smart/ui';
import { provideRuntimeConfig } from '../../core/config';
import { LANGUAGE_STORE, LanguageService } from '../../core/i18n';
import { settle, setupPage } from '../../testing/page-testing';
import { settingsRoutes } from './settings.routes';

async function open(language: 'de' | 'en' = 'de') {
  const saved: string[] = [];
  const harness = await setupPage(
    [{ path: 'mehr/einstellungen', loadChildren: () => settingsRoutes }],
    language,
    [
      provideRuntimeConfig(DEFAULT_RUNTIME_CONFIG),
      { provide: APPEARANCE_STORE, useValue: new MemoryAppearanceStore() },
      {
        provide: LANGUAGE_STORE,
        useValue: {
          load: () => language,
          save: (value: string) => saved.push(value),
          watch: () => () => undefined,
        },
      },
    ],
  );
  await harness.navigateByUrl('/mehr/einstellungen/darstellung');
  await settle(harness);
  const element = harness.routeNativeElement as HTMLElement;
  const button = (text: string) =>
    [...element.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes(text),
    ) as HTMLButtonElement;
  return { harness, element, button, saved };
}

describe('appearance page', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style');
    document.documentElement.setAttribute('lang', 'de');
  });

  it.each([
    ['de', 'Darstellung', 'Sprache'],
    ['en', 'Appearance', 'Language'],
  ] as const)('shows its title and the language choice in %s', async (language, title, label) => {
    const { element } = await open(language);

    expect(element.querySelector('h1')?.textContent?.trim()).toBe(title);
    expect(element.querySelector('h2')?.textContent?.trim()).toBe(label);
    expect(element.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe(label);
    expect(element.querySelector('ui-theme-editor')).not.toBeNull();
  });

  it('switches the language at once when English is chosen', async () => {
    const { harness, element, button, saved } = await open();
    const setLanguage = vi.spyOn(TestBed.inject(LanguageService), 'setLanguage');

    button('English').click();
    harness.detectChanges();
    await harness.fixture.whenStable();

    expect(setLanguage).toHaveBeenCalledWith('en');
    expect(TestBed.inject(LanguageService).language()).toBe('en');
    expect(saved).toEqual(['en']);
    await vi.waitFor(() => {
      harness.detectChanges();
      expect(element.querySelector('h1')?.textContent?.trim()).toBe('Appearance');
    });
  });

  it('marks the active language', async () => {
    const { element } = await open('en');
    const language = element.querySelector('[role="radiogroup"]')!;
    const checked = [...language.querySelectorAll('[role="radio"][aria-checked="true"]')];
    expect(checked.map((radio) => radio.textContent?.trim())).toEqual(['English']);
  });

  it('applies the chosen mode to the personal appearance at once', async () => {
    const { harness, button } = await open();
    const theme = TestBed.inject(ThemeService);

    button('Dunkel').click();
    harness.detectChanges();

    expect(theme.personal().mode).toBe('dark');
  });

  it('resets the personal appearance', async () => {
    const { harness, button } = await open();
    const theme = TestBed.inject(ThemeService);
    const resetPersonal = vi.spyOn(theme, 'resetPersonal');
    button('Dunkel').click();
    harness.detectChanges();

    button('Auf Standard zurücksetzen').click();
    harness.detectChanges();

    expect(resetPersonal).toHaveBeenCalledOnce();
    expect(theme.personal()).toEqual(DEFAULT_PERSONAL_APPEARANCE);
  });
});
