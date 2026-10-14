/**
 * Lets one thing through per key and interval. Memory is bounded: when more than `maxKeys` keys
 * are tracked, the longest unused ones are forgotten (and may pass again earlier than intended).
 */
export class Throttle {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly intervalMs: number,
    private readonly maxKeys: number,
  ) {}

  /** `true` (and starts a new interval) if the last pass of `key` is at least one interval ago. */
  allow(key: string, now: Date): boolean {
    const time = now.getTime();
    const previous = this.last.get(key);
    if (previous !== undefined && time - previous < this.intervalMs) return false;
    this.last.delete(key);
    this.last.set(key, time);
    if (this.last.size > this.maxKeys) {
      const oldest = this.last.keys().next();
      if (!oldest.done) this.last.delete(oldest.value);
    }
    return true;
  }
}
