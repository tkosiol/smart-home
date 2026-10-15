import { DOCUMENT, Injectable, inject } from '@angular/core';

/** Screen readers need a moment between clearing and filling the region to read the new text. */
const ANNOUNCE_DELAY_MS = 100;

/** Class of the live region; `styles.scss` hides it visually. */
const CLASS_NAME = 'ui-announcer';

/**
 * Tells screen readers about a change that has no visible focus target. Text comes translated.
 *
 * Its own live region, not CDK's `LiveAnnouncer`: that class shares a module with CDK's focus
 * trap, and a static import here, in the shell, would place the trap (about 9 kB) in the initial
 * bundle as well. The region sits at the end of the body; while a modal `<dialog>` is open
 * (`UiBottomSheet`) it moves inside, because everything outside a modal dialog is inert.
 */
@Injectable({ providedIn: 'root' })
export class UiAnnouncer {
  private readonly document = inject(DOCUMENT);
  private region: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  announce(message: string, politeness: 'polite' | 'assertive' = 'polite'): Promise<void> {
    const region = (this.region ??= this.createRegion());
    const host = this.document.querySelector('dialog[open]') ?? this.document.body;
    if (region.parentElement !== host) host.appendChild(region);
    region.setAttribute('aria-live', politeness);
    region.textContent = '';
    clearTimeout(this.timer);
    return new Promise((resolve) => {
      this.timer = setTimeout(() => {
        region.textContent = message;
        resolve();
      }, ANNOUNCE_DELAY_MS);
    });
  }

  private createRegion(): HTMLElement {
    const region = this.document.createElement('div');
    region.className = CLASS_NAME;
    region.setAttribute('aria-atomic', 'true');
    region.setAttribute('aria-live', 'polite');
    this.document.body.appendChild(region);
    return region;
  }
}
