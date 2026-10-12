import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate } from '@angular/service-worker';

/** Tells when the service worker holds a newer app version that a reload would activate. */
@Injectable({ providedIn: 'root' })
export class AppUpdates {
  private readonly document = inject(DOCUMENT);
  private readonly ready = signal(false);

  readonly updateReady = this.ready.asReadonly();

  constructor() {
    const swUpdate = inject(SwUpdate);
    if (swUpdate.isEnabled) {
      swUpdate.versionUpdates.pipe(takeUntilDestroyed()).subscribe((event) => {
        if (event.type === 'VERSION_READY') this.ready.set(true);
      });
    }
  }

  reload(): void {
    this.document.location.reload();
  }
}
