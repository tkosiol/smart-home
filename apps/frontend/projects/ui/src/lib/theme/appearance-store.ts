import { InjectionToken } from '@angular/core';
import {
  instanceAppearanceSchema,
  personalAppearanceSchema,
  type InstanceAppearance,
  type PersonalAppearance,
  type ThemeMode,
} from '@smart/contracts';

export interface BootCache {
  mode: ThemeMode;
  light: Record<string, string>;
  dark: Record<string, string>;
}

export interface AppearanceStore {
  loadInstance(): InstanceAppearance | null;
  loadPersonal(): PersonalAppearance | null;
  saveInstance(value: InstanceAppearance): void;
  savePersonal(value: PersonalAppearance): void;
  saveBootCache(value: BootCache): void;
}

const KEYS = {
  instance: 'smart.appearance.instance',
  personal: 'smart.appearance.personal',
  boot: 'smart.theme.boot',
} as const;
type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Stage 3 persistence in the browser; replaced by the API in stage 4. Never throws. */
export class LocalStorageAppearanceStore implements AppearanceStore {
  /** `storage` is for tests; by default `localStorage` is resolved lazily because merely reading it can throw. */
  constructor(private readonly storage?: KeyValueStorage) {}

  loadInstance(): InstanceAppearance | null {
    return this.read(KEYS.instance, (raw) => instanceAppearanceSchema.parse(raw));
  }
  loadPersonal(): PersonalAppearance | null {
    return this.read(KEYS.personal, (raw) => personalAppearanceSchema.parse(raw));
  }
  saveInstance(value: InstanceAppearance): void {
    this.write(KEYS.instance, value);
  }
  savePersonal(value: PersonalAppearance): void {
    this.write(KEYS.personal, value);
  }
  saveBootCache(value: BootCache): void {
    this.write(KEYS.boot, value);
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
}

export const APPEARANCE_STORE = new InjectionToken<AppearanceStore>('APPEARANCE_STORE', {
  providedIn: 'root',
  factory: () => new LocalStorageAppearanceStore(),
});
