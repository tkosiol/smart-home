import { InjectionToken } from '@angular/core';
import { languageSchema, type Language } from '@smart/contracts';

export interface LanguageStore {
  load(): Language | null;
  save(language: Language): void;
}

const KEY = 'smart.language';
type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Stage 3 persistence in the browser; stage 4 moves the choice to the user. Never throws. */
export class LocalStorageLanguageStore implements LanguageStore {
  /** `storage` is for tests; `localStorage` is resolved lazily because merely reading it can throw. */
  constructor(private readonly storage?: KeyValueStorage) {}

  load(): Language | null {
    try {
      const parsed = languageSchema.safeParse(
        (this.storage ?? globalThis.localStorage)?.getItem(KEY),
      );
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  save(language: Language): void {
    try {
      (this.storage ?? globalThis.localStorage)?.setItem(KEY, language);
    } catch {
      // Storage blocked or full: the language still applies for this session.
    }
  }
}

export const LANGUAGE_STORE = new InjectionToken<LanguageStore>('LANGUAGE_STORE', {
  providedIn: 'root',
  factory: () => new LocalStorageLanguageStore(),
});

/** The browser's preferred languages, most preferred first. */
export const BROWSER_LANGUAGES = new InjectionToken<readonly string[]>('BROWSER_LANGUAGES', {
  providedIn: 'root',
  factory: () => globalThis.navigator?.languages ?? [],
});
