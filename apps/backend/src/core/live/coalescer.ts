interface Slot {
  timer: NodeJS.Timeout;
  pending: (() => Promise<void>) | undefined;
}

/**
 * At most one run per key and window. The first call runs at once and opens a window; calls inside
 * it replace each other, and the latest one runs when the window ends (opening the next window).
 * A failing run goes to `onError` and does not disturb the window.
 */
export class Coalescer {
  private readonly slots = new Map<string, Slot>();

  constructor(
    private readonly windowMs: number,
    private readonly onError: (error: unknown) => void,
  ) {}

  schedule(key: string, run: () => Promise<void>): void {
    const slot = this.slots.get(key);
    if (slot) {
      slot.pending = run;
      return;
    }
    this.open(key, undefined);
    this.execute(run);
  }

  dispose(): void {
    for (const slot of this.slots.values()) clearTimeout(slot.timer);
    this.slots.clear();
  }

  private open(key: string, pending: Slot['pending']): void {
    const slot: Slot = {
      pending,
      timer: setTimeout(() => {
        const next = slot.pending;
        if (next) {
          this.open(key, undefined);
          this.execute(next);
        } else {
          this.slots.delete(key);
        }
      }, this.windowMs),
    };
    slot.timer.unref();
    this.slots.set(key, slot);
  }

  private execute(run: () => Promise<void>): void {
    try {
      run().catch(this.onError);
    } catch (error) {
      this.onError(error);
    }
  }
}
