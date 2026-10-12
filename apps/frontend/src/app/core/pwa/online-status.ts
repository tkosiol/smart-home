import { DOCUMENT, Injectable, InjectionToken, inject, signal } from '@angular/core';

/** Reads the browser's connectivity flag; replaced in tests. */
export const NAVIGATOR_ONLINE = new InjectionToken<() => boolean>('NAVIGATOR_ONLINE', {
  factory: () => () => navigator.onLine,
});

/** Whether the browser reports a network connection. */
@Injectable({ providedIn: 'root' })
export class OnlineStatus {
  private readonly read = inject(NAVIGATOR_ONLINE);
  private readonly state = signal(this.read());

  readonly online = this.state.asReadonly();

  constructor() {
    const view = inject(DOCUMENT).defaultView;
    const update = () => this.state.set(this.read());
    view?.addEventListener('online', update);
    view?.addEventListener('offline', update);
  }
}
