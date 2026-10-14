import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject } from '@angular/core';
import { ApiError } from '../../core/api';

/** How often shown values are fetched again while the page is in view. */
export const REFRESH_MS = 60_000;

/**
 * Calls `reload` every minute while the tab is visible, and when it becomes visible again. The
 * first load is the caller's. Ends with the injection context's lifetime. Call it in an injection
 * context.
 */
export function refreshWhileVisible(reload: () => void): void {
  const document = inject(DOCUMENT);
  const reloadIfVisible = () => {
    if (document.visibilityState === 'visible') reload();
  };
  const timer = setInterval(reloadIfVisible, REFRESH_MS);
  document.addEventListener('visibilitychange', reloadIfVisible);
  inject(DestroyRef).onDestroy(() => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', reloadIfVisible);
  });
}

/** A request that failed for lack of a connection: not worth a message every minute. */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}
