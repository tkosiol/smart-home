/**
 * Sliding-window counter in memory: at most `limit` hits per key within `windowMs`. Process-local
 * by design (one backend instance serves a household); a restart resets it. The number of keys is
 * bounded: when full, expired keys are dropped first, then the oldest ones.
 */
export class HitLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Counts a hit unless the limit is reached; synchronous, so concurrent callers cannot overshoot. */
  hit(key: string, now: Date): { allowed: true } | { allowed: false; retryAt: Date } {
    const since = now.getTime() - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((time) => time > since);
    const blocking = recent.length >= this.limit ? recent[recent.length - this.limit] : undefined;
    if (blocking !== undefined) {
      this.hits.set(key, recent);
      return { allowed: false, retryAt: new Date(blocking + this.windowMs) };
    }
    recent.push(now.getTime());
    // Re-inserting moves the key to the end, so the Map stays ordered by last use.
    this.hits.delete(key);
    this.hits.set(key, recent);
    this.evict(since);
    return { allowed: true };
  }

  clear(key: string): void {
    this.hits.delete(key);
  }

  get size(): number {
    return this.hits.size;
  }

  private evict(since: number): void {
    if (this.hits.size <= this.maxKeys) return;
    for (const [key, times] of this.hits) {
      if ((times.at(-1) ?? 0) <= since) this.hits.delete(key);
    }
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break;
      this.hits.delete(key);
    }
  }
}
