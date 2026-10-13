import { Injectable, InjectionToken, inject } from '@angular/core';

/** The one `sessionStorage` key of this feature. */
const TOKEN_KEY = 'smart.invitation';
type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** The tab's `sessionStorage`; null where reading it throws. Tests replace it. */
export const INVITATION_STORAGE = new InjectionToken<KeyValueStorage | null>('INVITATION_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return globalThis.sessionStorage ?? null;
    } catch {
      return null;
    }
  },
});

/**
 * The token of the invitation being answered. The link carries it only until the page has read it
 * (the address bar must not keep it); from then on it lives here, in this tab's `sessionStorage`,
 * so it survives the sign-in round trip and a reload, and goes away once the invitation is
 * accepted or found invalid. Never in a URL, a title, the device copy of the user or `localStorage`.
 * Without usable storage the token stays in memory for the life of the page.
 */
@Injectable({ providedIn: 'root' })
export class InvitationToken {
  private readonly storage = inject(INVITATION_STORAGE);
  private memory: string | null = null;

  get(): string | null {
    try {
      return this.storage?.getItem(TOKEN_KEY) ?? this.memory;
    } catch {
      return this.memory;
    }
  }

  set(token: string): void {
    this.memory = token;
    try {
      this.storage?.setItem(TOKEN_KEY, token);
    } catch {
      // Blocked or full: the token stays in memory.
    }
  }

  clear(): void {
    this.memory = null;
    try {
      this.storage?.removeItem(TOKEN_KEY);
    } catch {
      // Nothing to remove.
    }
  }
}
