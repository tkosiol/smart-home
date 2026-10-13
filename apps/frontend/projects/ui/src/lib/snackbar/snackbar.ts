import { Injectable, Injector, inject } from '@angular/core';
import type { UiSnackbarData } from './snackbar-content';

/** Plain messages close after this time; messages with an action stay until the user reacts (WCAG 2.2.1). */
const PLAIN_DURATION_MS = 4000;

/**
 * Marks the snack bar for the global rule in `styles.scss` that lifts it above the compact
 * bottom navigation bar.
 */
const PANEL_CLASS = 'ui-snackbar';

/** Short, temporary feedback at the bottom of the screen. Texts come translated from the caller. */
@Injectable({ providedIn: 'root' })
export class UiSnackbar {
  private readonly injector = inject(Injector);

  /**
   * A message with an `action` stays until the user presses the action or closes it; a plain
   * message closes by itself. Resolves with how it was closed. Material's snack bar and overlay
   * load on first use: the shell injects this service (via the API error helper), and they must
   * not weigh on the initial bundle.
   */
  async show(
    message: string,
    options: { action?: string; politeness?: 'polite' | 'assertive' } = {},
  ): Promise<'action' | 'dismissed'> {
    const [{ MatSnackBar }, { UiSnackbarContent }] = await Promise.all([
      import('@angular/material/snack-bar'),
      import('./snackbar-content'),
    ]);
    const data: UiSnackbarData = { message, action: options.action };
    const ref = this.injector.get(MatSnackBar).openFromComponent(UiSnackbarContent, {
      data,
      duration: options.action ? undefined : PLAIN_DURATION_MS,
      politeness: options.politeness ?? 'polite',
      panelClass: PANEL_CLASS,
    });
    return new Promise((resolve) => {
      ref
        .afterDismissed()
        .subscribe(({ dismissedByAction }) => resolve(dismissedByAction ? 'action' : 'dismissed'));
    });
  }
}
