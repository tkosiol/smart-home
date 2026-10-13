import { HitLimiter } from './hit-limiter.js';

const at = (ms: number): Date => new Date(1_000_000 + ms);

describe('HitLimiter', () => {
  it('allows `limit` hits per window and then says when the next one is allowed', () => {
    const limiter = new HitLimiter(3, 1000);
    expect(limiter.hit('a', at(0))).toEqual({ allowed: true });
    expect(limiter.hit('a', at(100))).toEqual({ allowed: true });
    expect(limiter.hit('a', at(200))).toEqual({ allowed: true });
    expect(limiter.hit('a', at(300))).toEqual({ allowed: false, retryAt: at(1000) });
    expect(limiter.hit('a', at(999))).toEqual({ allowed: false, retryAt: at(1000) });
    expect(limiter.hit('a', at(1001))).toEqual({ allowed: true });
  });

  it('does not count refused hits and keeps keys apart', () => {
    const limiter = new HitLimiter(1, 1000);
    expect(limiter.hit('a', at(0)).allowed).toBe(true);
    for (let i = 0; i < 5; i++) expect(limiter.hit('a', at(10 + i)).allowed).toBe(false);
    expect(limiter.hit('b', at(20)).allowed).toBe(true);
    expect(limiter.hit('a', at(1000)).allowed).toBe(true);
  });

  it('forgets a key on clear', () => {
    const limiter = new HitLimiter(1, 1000);
    limiter.hit('a', at(0));
    limiter.clear('a');
    expect(limiter.hit('a', at(1)).allowed).toBe(true);
  });

  it('stays bounded: drops expired keys first, then the oldest', () => {
    const limiter = new HitLimiter(1, 1000, 3);
    limiter.hit('old', at(0));
    limiter.hit('b', at(1500));
    limiter.hit('c', at(1501));
    limiter.hit('d', at(1502));
    expect(limiter.size).toBe(3);
    expect(limiter.hit('old', at(1503)).allowed).toBe(true);

    for (let i = 0; i < 50; i++) limiter.hit(`k${i}`, at(1600));
    expect(limiter.size).toBeLessThanOrEqual(3);
  });
});
