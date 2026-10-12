import { LiveAnnouncer } from '@angular/cdk/a11y';
import { Injectable, inject } from '@angular/core';

/** Tells screen readers about a change that has no visible focus target. Text comes translated. */
@Injectable({ providedIn: 'root' })
export class UiAnnouncer {
  private readonly live = inject(LiveAnnouncer);

  announce(message: string, politeness: 'polite' | 'assertive' = 'polite'): Promise<void> {
    return this.live.announce(message, politeness);
  }
}
