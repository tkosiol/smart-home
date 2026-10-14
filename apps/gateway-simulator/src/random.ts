/** Small seeded generator (mulberry32): the same seed always gives the same sequence. */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A number in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A number in [min, max). */
  between(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** A whole number in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.between(min, max + 1));
  }
}
