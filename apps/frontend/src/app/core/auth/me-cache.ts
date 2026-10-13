import { InjectionToken } from '@angular/core';
import { meSchema, type Me } from '@smart/contracts';

/** The device's copy of the signed-in user, so the app can start without a connection. */
export interface MeCache {
  load(): Me | null;
  save(me: Me): void;
  clear(): void;
  /** Drops the theme cache that `theme-boot.js` applies before the app starts. */
  clearThemeBoot(): void;
}

const ME_KEY = 'smart.me';
// Written by the ThemeService (projects/ui/src/lib/theme/appearance-store.ts); it holds the
// previous user's colors, so signing out removes it.
const THEME_BOOT_KEY = 'smart.theme.boot';
type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Keeps only the fields of `meSchema` (no secrets) in `localStorage`. Never throws: without
 * storage the app still works, it just cannot start offline.
 */
export class LocalStorageMeCache implements MeCache {
  /** `storage` is for tests; `localStorage` is resolved lazily because merely reading it can throw. */
  constructor(private readonly storage?: KeyValueStorage) {}

  load(): Me | null {
    try {
      const raw = (this.storage ?? globalThis.localStorage)?.getItem(ME_KEY);
      if (!raw) return null;
      const parsed = meSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  save(me: Me): void {
    try {
      // Parsing drops everything the schema does not name.
      (this.storage ?? globalThis.localStorage)?.setItem(
        ME_KEY,
        JSON.stringify(meSchema.parse(me)),
      );
    } catch {
      // Storage blocked or full: the user stays signed in, the offline start is lost.
    }
  }

  clear(): void {
    this.remove(ME_KEY);
  }

  clearThemeBoot(): void {
    this.remove(THEME_BOOT_KEY);
  }

  private remove(key: string): void {
    try {
      (this.storage ?? globalThis.localStorage)?.removeItem(key);
    } catch {
      // Nothing stored that could be removed.
    }
  }
}

export const ME_CACHE = new InjectionToken<MeCache>('ME_CACHE', {
  providedIn: 'root',
  factory: () => new LocalStorageMeCache(),
});
