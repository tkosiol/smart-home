import { describe, expect, it } from 'vitest';
import { measurementTime } from './measurement-time.js';

const NOW = new Date('2026-10-14T12:00:00.000Z');
const minutes = (n: number): number => n * 60_000;
const at = (offsetMs: number): string => new Date(NOW.getTime() + offsetMs).toISOString();

describe('measurementTime', () => {
  it('takes a plausible last_seen as it is', () => {
    const lastSeen = at(-minutes(5));
    expect(measurementTime(lastSeen, NOW)).toEqual({ time: new Date(lastSeen), replaced: false });
  });

  it('accepts an explicit offset', () => {
    expect(measurementTime('2026-10-14T13:55:00+02:00', NOW)).toEqual({
      time: new Date('2026-10-14T11:55:00.000Z'),
      replaced: false,
    });
  });

  it('tolerates a clock that is up to two minutes ahead', () => {
    expect(measurementTime(at(minutes(2)), NOW).replaced).toBe(false);
  });

  it('replaces a time more than two minutes in the future', () => {
    expect(measurementTime(at(minutes(2) + 1000), NOW)).toEqual({ time: NOW, replaced: true });
  });

  it('keeps a time that is just under seven days old and replaces an older one', () => {
    expect(measurementTime(at(-(7 * 24 * 60 * minutes(1))), NOW).replaced).toBe(false);
    expect(measurementTime(at(-(8 * 24 * 60 * minutes(1))), NOW)).toEqual({
      time: NOW,
      replaced: true,
    });
  });

  it('replaces the epoch', () => {
    expect(measurementTime('1970-01-01T00:00:00Z', NOW)).toEqual({ time: NOW, replaced: true });
  });

  it('does not trust a time without an offset', () => {
    expect(measurementTime('2026-10-14T11:55:00', NOW)).toEqual({ time: NOW, replaced: true });
  });

  it('does not trust numbers, garbage or a missing value', () => {
    for (const value of [NOW.getTime(), 1_791_000_000, 'yesterday', 'Z', '', null, undefined, {}]) {
      expect(measurementTime(value, NOW)).toEqual({ time: NOW, replaced: true });
    }
  });
});
