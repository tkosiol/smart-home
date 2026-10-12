import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

/** Plain messages close after this time; messages with an action stay until the user reacts (WCAG 2.2.1). */
const PLAIN_DURATION_MS = 4000;

/** Short, temporary feedback at the bottom of the screen. Texts come translated from the caller. */
@Injectable({ providedIn: 'root' })
export class UiSnackbar {
  private readonly snackBar = inject(MatSnackBar);

  show(
    message: string,
    options: { action?: string; durationMs?: number } = {},
  ): Promise<'action' | 'dismissed'> {
    const duration = options.durationMs ?? (options.action ? undefined : PLAIN_DURATION_MS);
    const ref = this.snackBar.open(message, options.action, { duration, politeness: 'polite' });
    return new Promise((resolve) => {
      ref
        .afterDismissed()
        .subscribe(({ dismissedByAction }) => resolve(dismissedByAction ? 'action' : 'dismissed'));
    });
  }
}
