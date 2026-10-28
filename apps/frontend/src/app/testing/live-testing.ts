import type { LiveEventData, LiveEventType } from '@smart/contracts';
import type { LiveHandlers } from '../core/live';

/** Stands in for `LiveService` in specs: a test sends events and resyncs by hand. */
export class FakeLive {
  private handlers: LiveHandlers[] = [];

  subscribe(handlers: LiveHandlers): () => void {
    this.handlers.push(handlers);
    return () => (this.handlers = this.handlers.filter((other) => other !== handlers));
  }

  /** How many subscriptions are open. */
  get subscriptions(): number {
    return this.handlers.length;
  }

  emit<T extends LiveEventType>(type: T, data: LiveEventData<T>): void {
    for (const handlers of [...this.handlers]) {
      const handler = handlers[type] as ((data: LiveEventData<T>) => void) | undefined;
      handler?.(data);
    }
  }

  resync(): void {
    for (const handlers of [...this.handlers]) handlers.resync?.();
  }
}
