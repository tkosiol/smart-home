interface Slot {
  timer: NodeJS.Timeout | undefined;
  pending: (() => Promise<void>) | undefined;
  windowOver: boolean;
  running: boolean;
}

/**
 * At most one run per key and window, and never two runs of a key at once. The first call runs at
 * once and opens a window; calls inside it replace each other, and the latest one runs when the
 * window has ended and the run before it has settled (opening the next window). A failing run goes
 * to `onError` and does not disturb the window.
 */
export class Coalescer {
  private readonly slots = new Map<string, Slot>();
  private disposed = false;

  constructor(
    private readonly windowMs: number,
    private readonly onError: (error: unknown) => void,
  ) {}

  schedule(key: string, run: () => Promise<void>): void {
    if (this.disposed) return;
    const slot = this.slots.get(key);
    if (slot) {
      slot.pending = run;
      return;
    }
    const fresh: Slot = { timer: undefined, pending: undefined, windowOver: false, running: false };
    this.slots.set(key, fresh);
    this.start(key, fresh, run);
  }

  dispose(): void {
    this.disposed = true;
    for (const slot of this.slots.values()) clearTimeout(slot.timer);
    this.slots.clear();
  }

  /** Opens a window for the slot and runs. */
  private start(key: string, slot: Slot, run: () => Promise<void>): void {
    slot.windowOver = false;
    slot.running = true;
    slot.timer = setTimeout(() => {
      slot.windowOver = true;
      this.flush(key, slot);
    }, this.windowMs);
    slot.timer.unref();
    let result: Promise<void>;
    try {
      result = run();
    } catch (error) {
      result = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    result.catch(this.onError).finally(() => {
      slot.running = false;
      this.flush(key, slot);
    });
  }

  /** Runs the pending call once the window is over and nothing is in flight; else ends the slot. */
  private flush(key: string, slot: Slot): void {
    if (this.disposed || !slot.windowOver || slot.running) return;
    const next = slot.pending;
    slot.pending = undefined;
    if (next) this.start(key, slot, next);
    else this.slots.delete(key);
  }
}
