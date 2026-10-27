import { DOCUMENT } from '@angular/common';
import { DestroyRef, computed, inject, signal } from '@angular/core';
import { ApiError } from '../api';

/** How often shown values are fetched again while the page is in view. */
export const REFRESH_MS = 60_000;

/** A request that failed for lack of a connection: not worth a message every minute. */
export function isNetworkFailure(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

/**
 * Lets one refresh run at a time: a task that is started while another one is still running is
 * skipped (the running one fetches the same thing). `refreshing` stays true until the running task
 * has ended, also when it failed, so the error handler of the load can tell a refresh from a first
 * load.
 */
export class RefreshGuard {
  private readonly running = signal(0);
  /** Whether a guarded task is running. */
  readonly refreshing = computed(() => this.running() > 0);

  /** Runs `task` unless another one is running. A failing task ends the refresh and rethrows. */
  async run(task: () => Promise<unknown>): Promise<void> {
    if (this.running() > 0) return;
    this.running.update((count) => count + 1);
    try {
      await task();
    } finally {
      this.running.update((count) => count - 1);
    }
  }

  /** Wraps an error handler: a network failure during a refresh is dropped, the rest is handed on. */
  quietNetworkFailure(handle: (error: unknown) => void): (error: unknown) => void {
    return (error) => {
      if (!(this.refreshing() && isNetworkFailure(error))) handle(error);
    };
  }
}

/**
 * Runs `reload` through `guard` every `intervalMs` (a minute) while the tab is visible, and when it becomes visible
 * again; a tick or a visibility change that meets a load still running does nothing. The first
 * load is the caller's. Ends with the injection context's lifetime. Call it in an injection
 * context.
 */
export function refreshWhileVisible(
  guard: RefreshGuard,
  reload: () => Promise<unknown>,
  intervalMs: number = REFRESH_MS,
): void {
  const document = inject(DOCUMENT);
  const reloadIfVisible = () => {
    // The load reports its own errors; a rejection here would only be unhandled.
    if (document.visibilityState === 'visible') void guard.run(reload).catch(() => undefined);
  };
  const timer = setInterval(reloadIfVisible, intervalMs);
  document.addEventListener('visibilitychange', reloadIfVisible);
  inject(DestroyRef).onDestroy(() => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', reloadIfVisible);
  });
}
