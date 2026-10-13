import { DOCUMENT, DestroyRef, Injectable, inject, signal } from '@angular/core';
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
  private readonly listeners = new Set<(language: Language) => void>();
  readonly language = this.state.asReadonly();

  constructor() {
    this.apply(this.state());
    // Another tab chose a language: follow it (without storing it again) so all tabs agree.
    const stopWatching = this.store.watch(() => {
      const stored = this.store.load();
      if (stored && stored !== this.state()) {
        this.state.set(stored);
        this.apply(stored);
      }
    });
    inject(DestroyRef).onDestroy(stopWatching);
  }

  /** The user chose a language: switches, stores and tells the listeners. */
  setLanguage(language: Language): void {
    this.adopt(language);
    for (const listener of this.listeners) listener(this.state());
  }

  /** Takes over a language that did not come from the user (the account on the server): no listener hears of it. */
  adopt(language: Language): void {
    const parsed = languageSchema.parse(language);
    this.state.set(parsed);
    this.store.save(parsed);
    this.apply(parsed);
  }

  /** Calls back after every choice of the user, never for `adopt` or another tab; returns the unsubscribe function. */
  onChange(listener: (language: Language) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** `<html lang>` drives screen reader pronunciation and `hyphens: auto`; the format context drives dates and numbers. */
  private apply(language: Language): void {
    this.transloco.setActiveLang(language);
    this.formatContext.locale.set(language);
    this.document.documentElement.lang = language;
  }
}
