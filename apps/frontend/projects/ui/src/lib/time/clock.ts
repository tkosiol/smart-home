import { DestroyRef, Injectable, inject, signal, type Signal } from '@angular/core';

const TICK_MS = 30_000;

/** Current time as a signal, so relative times update by themselves. */
@Injectable({ providedIn: 'root' })
export class UiClock {
  private readonly current = signal(Date.now());
  readonly now: Signal<number> = this.current.asReadonly();

  constructor() {
    const timer = setInterval(() => this.current.set(Date.now()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
