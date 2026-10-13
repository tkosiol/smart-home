import { InjectionToken } from '@angular/core';
import { preferencesUpdateSchema, type PreferencesUpdate } from '@smart/contracts';

/**
 * Settings the user changed that the server has not confirmed yet (no connection, or the request
 * failed). While one exists it is newer than anything the server told this device, so it wins
 * over the user of the next load and is sent first.
 */
export type PendingPreferences = PreferencesUpdate;

export interface PendingPreferencesStore {
  load(): PendingPreferences | null;
  save(value: PendingPreferences): void;
  clear(): void;
}

const KEY = 'smart.me.pending';
type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Keeps the unsent changes in `localStorage` so they survive a reload. Never throws. */
export class LocalStoragePendingPreferences implements PendingPreferencesStore {
  /** `storage` is for tests; `localStorage` is resolved lazily because merely reading it can throw. */
  constructor(private readonly storage?: KeyValueStorage) {}

  load(): PendingPreferences | null {
    try {
      const raw = (this.storage ?? globalThis.localStorage)?.getItem(KEY);
      if (!raw) return null;
      const parsed = preferencesUpdateSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  save(value: PendingPreferences): void {
    try {
      (this.storage ?? globalThis.localStorage)?.setItem(KEY, JSON.stringify(value));
    } catch {
      // Storage blocked or full: the change is still sent in this session.
    }
  }

  clear(): void {
    try {
      (this.storage ?? globalThis.localStorage)?.removeItem(KEY);
    } catch {
      // Nothing stored that could be removed.
    }
  }
}

export const PENDING_PREFERENCES = new InjectionToken<PendingPreferencesStore>(
  'PENDING_PREFERENCES',
  { providedIn: 'root', factory: () => new LocalStoragePendingPreferences() },
);
