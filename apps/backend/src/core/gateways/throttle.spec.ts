import { describe, expect, it } from 'vitest';
import { Throttle } from './throttle.js';

const at = (ms: number): Date => new Date(1_000_000 + ms);

describe('Throttle', () => {
  it('lets one call per key and interval through', () => {
    const throttle = new Throttle(60_000, 10);
    expect(throttle.allow('a', at(0))).toBe(true);
    expect(throttle.allow('a', at(59_999))).toBe(false);
    expect(throttle.allow('b', at(1))).toBe(true);
    expect(throttle.allow('a', at(60_000))).toBe(true);
    expect(throttle.allow('a', at(60_001))).toBe(false);
  });

  it('keeps at most maxKeys keys, forgetting the longest unused first', () => {
    const throttle = new Throttle(60_000, 2);
    throttle.allow('a', at(0));
    throttle.allow('b', at(1));
    throttle.allow('c', at(2));
    expect(throttle.allow('b', at(3))).toBe(false);
    expect(throttle.allow('c', at(3))).toBe(false);
    expect(throttle.allow('a', at(3))).toBe(true);
  });
});
