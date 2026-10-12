import { InjectionToken } from '@angular/core';
import {
  instanceAppearanceSchema,
  personalAppearanceSchema,
  type InstanceAppearance,
  type PersonalAppearance,
  type ThemeMode,
} from '@smart/contracts';

/** Bump when the cache format changes; theme-boot.js ignores other versions. */
export const BOOT_CACHE_VERSION = 2;

/**
 * What theme-boot.js applies before Angular starts. Both modes are cached so "system" follows the
 * OS without a flash; while the contrast follows the system, both contrast levels are cached too.
 */
export interface BootCache {
  readonly v: typeof BOOT_CACHE_VERSION;
  readonly mode: ThemeMode;
  readonly followsSystemContrast: boolean;
  readonly light: Record<string, string>;
  readonly dark: Record<string, string>;
  readonly lightHigh?: Record<string, string>;
  readonly darkHigh?: Record<string, string>;
}

export type AppearanceKey = 'instance' | 'personal';

export interface AppearanceStore {
  loadInstance(): InstanceAppearance | null;
  loadPersonal(): PersonalAppearance | null;
  saveInstance(value: InstanceAppearance): void;
  savePersonal(value: PersonalAppearance): void;
  clearInstance(): void;
  clearPersonal(): void;
  saveBootCache(value: BootCache): void;
  /** Calls back when another tab changed a stored appearance; returns the unsubscribe function. */
  watch(callback: (key: AppearanceKey) => void): () => void;
}

const KEYS = {
  instance: 'smart.appearance.instance',
  personal: 'smart.appearance.personal',
  boot: 'smart.theme.boot',
} as const;
type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Stage 3 persistence in the browser; replaced by the API in stage 4. Never throws. */
export class LocalStorageAppearanceStore implements AppearanceStore {
  /** `storage` is for tests; by default `localStorage` is resolved lazily because merely reading it can throw. */
  constructor(private readonly storage?: KeyValueStorage) {}

  loadInstance(): InstanceAppearance | null {
    return this.read(KEYS.instance, (raw) => instanceAppearanceSchema.parse(raw));
  }
  loadPersonal(): PersonalAppearance | null {
    return this.read(KEYS.personal, (raw) => {
      const full = personalAppearanceSchema.safeParse(raw);
      if (full.success) return full.data;
      // Keep mode and contrast when only the stored colors are unusable (e.g. an older format).
      const rest = typeof raw === 'object' && raw !== null ? raw : {};
      return personalAppearanceSchema.parse({ ...rest, colors: undefined });
    });
  }
  saveInstance(value: InstanceAppearance): void {
    this.write(KEYS.instance, value);
  }
  savePersonal(value: PersonalAppearance): void {
    this.write(KEYS.personal, value);
  }
  clearInstance(): void {
    this.remove(KEYS.instance);
  }
  clearPersonal(): void {
    this.remove(KEYS.personal);
  }
  saveBootCache(value: BootCache): void {
    this.write(KEYS.boot, value);
  }

  watch(callback: (key: AppearanceKey) => void): () => void {
    const target = globalThis.window;
    if (!target?.addEventListener) return () => undefined;
    const listener = (event: StorageEvent) => {
      if (event.key === KEYS.instance || event.key === null) callback('instance');
      if (event.key === KEYS.personal || event.key === null) callback('personal');
    };
    target.addEventListener('storage', listener);
    return () => target.removeEventListener('storage', listener);
  }

  /** Only call inside try/catch: accessing localStorage throws a SecurityError when site data is blocked. */
  private resolveStorage(): KeyValueStorage | undefined {
    return this.storage ?? globalThis.localStorage;
  }
  private read<T>(key: string, parse: (raw: unknown) => T): T | null {
    try {
      const raw = this.resolveStorage()?.getItem(key);
      return raw ? parse(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }
  private write(key: string, value: unknown): void {
    try {
      this.resolveStorage()?.setItem(key, JSON.stringify(value));
    } catch {
      // Storage blocked or full: the theme still works for this session.
    }
  }
  private remove(key: string): void {
    try {
      this.resolveStorage()?.removeItem(key);
    } catch {
      // Storage blocked: nothing stored that could be removed.
    }
  }
}

export const APPEARANCE_STORE = new InjectionToken<AppearanceStore>('APPEARANCE_STORE', {
  providedIn: 'root',
  factory: () => new LocalStorageAppearanceStore(),
});
