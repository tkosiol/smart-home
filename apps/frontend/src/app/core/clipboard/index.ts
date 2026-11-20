import { InjectionToken } from '@angular/core';

/** Writes text to the clipboard; null where the browser has no clipboard API. Tests replace it. */
export const WRITE_CLIPBOARD = new InjectionToken<((text: string) => Promise<void>) | null>(
  'WRITE_CLIPBOARD',
  {
    providedIn: 'root',
    factory: () => {
      const clipboard = globalThis.navigator?.clipboard;
      return clipboard?.writeText ? (text) => clipboard.writeText(text) : null;
    },
  },
);
