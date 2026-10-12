import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { languageSchema, matchLanguage, type Language } from '@smart/contracts';
import { UiFormatContext } from '@smart/ui';
import { BROWSER_LANGUAGES, LANGUAGE_STORE } from './language-store';

/** Active UI language: stored choice, else the browser's preference, else German (spec 7). */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly transloco = inject(TranslocoService);
  private readonly store = inject(LANGUAGE_STORE);
  private readonly document = inject(DOCUMENT);
  private readonly formatContext = inject(UiFormatContext);
  private readonly state = signal<Language>(
    this.store.load() ?? matchLanguage(inject(BROWSER_LANGUAGES)),
  );
  readonly language = this.state.asReadonly();

  constructor() {
    this.apply(this.state());
  }

  setLanguage(language: Language): void {
    const parsed = languageSchema.parse(language);
    this.state.set(parsed);
    this.store.save(parsed);
    this.apply(parsed);
  }

  /** `<html lang>` drives screen reader pronunciation and `hyphens: auto`; the format context drives dates and numbers. */
  private apply(language: Language): void {
    this.transloco.setActiveLang(language);
    this.formatContext.locale.set(language);
    this.document.documentElement.lang = language;
  }
}
