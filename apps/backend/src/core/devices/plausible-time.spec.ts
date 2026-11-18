import { describe, expect, it } from 'vitest';
import { plausibleTime } from './plausible-time.js';

const NOW = new Date('2026-10-14T12:00:00.000Z');
const minutes = (n: number): number => n * 60_000;
const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);

describe('plausibleTime', () => {
  it('takes a plausible time as it is', () => {
    const measuredAt = at(-minutes(5));
    expect(plausibleTime(measuredAt, NOW)).toEqual({ time: measuredAt, replaced: false });
  });

  it('takes the receive time when the hardware does not say when it measured', () => {
    expect(plausibleTime(undefined, NOW)).toEqual({ time: NOW, replaced: true });
  });

  it('tolerates a clock that is up to two minutes ahead', () => {
    expect(plausibleTime(at(minutes(2)), NOW).replaced).toBe(false);
  });

  it('replaces a time more than two minutes in the future', () => {
    expect(plausibleTime(at(minutes(2) + 1000), NOW)).toEqual({ time: NOW, replaced: true });
  });

  it('keeps a time that is just under seven days old and replaces an older one', () => {
    expect(plausibleTime(at(-(7 * 24 * 60 * minutes(1))), NOW).replaced).toBe(false);
    expect(plausibleTime(at(-(8 * 24 * 60 * minutes(1))), NOW)).toEqual({
      time: NOW,
      replaced: true,
    });
  });

  it('replaces the epoch', () => {
    expect(plausibleTime(new Date('1970-01-01T00:00:00Z'), NOW)).toEqual({
      time: NOW,
      replaced: true,
    });
  });

  it('replaces an invalid date', () => {
    expect(plausibleTime(new Date(Number.NaN), NOW)).toEqual({ time: NOW, replaced: true });
  });
});
