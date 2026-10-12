import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UiSnackbarContent, type UiSnackbarData } from './snackbar-content';

/** Plain messages close after this time; messages with an action stay until the user reacts (WCAG 2.2.1). */
const PLAIN_DURATION_MS = 4000;

/** Short, temporary feedback at the bottom of the screen. Texts come translated from the caller. */
@Injectable({ providedIn: 'root' })
export class UiSnackbar {
  private readonly snackBar = inject(MatSnackBar);

  /**
   * A message with an `action` stays until the user presses the action or closes it; a plain
   * message closes by itself. Resolves with how it was closed.
   */
  show(
    message: string,
    options: { action?: string; politeness?: 'polite' | 'assertive' } = {},
  ): Promise<'action' | 'dismissed'> {
    const data: UiSnackbarData = { message, action: options.action };
    const ref = this.snackBar.openFromComponent(UiSnackbarContent, {
      data,
      duration: options.action ? undefined : PLAIN_DURATION_MS,
      politeness: options.politeness ?? 'polite',
    });
    return new Promise((resolve) => {
      ref
        .afterDismissed()
        .subscribe(({ dismissedByAction }) => resolve(dismissedByAction ? 'action' : 'dismissed'));
    });
  }
}
