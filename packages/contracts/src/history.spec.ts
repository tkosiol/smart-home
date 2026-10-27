import { describe, expect, it } from 'vitest';
import {
  deviceHistorySchema,
  historyDaySchema,
  historyPointSchema,
  historyQuerySchema,
  historySummary,
  timeBelow,
  wateringEvents,
  RESOLUTION_MINUTES,
  type DeviceHistory,
  type HistoryPoint,
} from './history.js';

const BASE = Date.parse('2026-10-20T00:00:00Z');

function at(minutes: number): string {
  return new Date(BASE + minutes * 60_000).toISOString().replace('.000Z', 'Z');
}

function point(minutes: number, avg: number, extra: Partial<HistoryPoint> = {}): HistoryPoint {
  return { t: at(minutes), avg, min: avg, max: avg, last: avg, ...extra };
}

function history(points: HistoryPoint[], resolution: '15m' | '1h' = '15m'): DeviceHistory {
  return {
    capability: 'soil_moisture',
    unit: '%',
    range: '24h',
    resolution,
    from: at(0),
    to: at(1440),
    points,
    days: [],
  };
}

describe('history schemas', () => {
  const validPoint = { t: '2026-10-20T00:00:00Z', avg: 1, min: 0, max: 2, last: 1.5 };

  it('accepts a valid point and day', () => {
    expect(historyPointSchema.safeParse(validPoint).success).toBe(true);
    expect(
      historyDaySchema.safeParse({
        date: '2026-10-20',
        avg: 1,
        min: 0,
        max: 2,
        last: 1,
        partial: true,
      }).success,
    ).toBe(true);
  });

  it('rejects a time without Z and an impossible date', () => {
    expect(historyPointSchema.safeParse({ ...validPoint, t: '2026-10-20T00:00:00' }).success).toBe(
      false,
    );
    expect(
      historyDaySchema.safeParse({
        date: '2026-02-30',
        avg: 1,
        min: 0,
        max: 2,
        last: 1,
        partial: false,
      }).success,
    ).toBe(false);
  });

  it('accepts a full history and rejects an unknown range', () => {
    const valid = {
      capability: 'soil_moisture',
      unit: null,
      range: '7d',
      resolution: '1h',
      from: '2026-10-13T00:00:00Z',
      to: '2026-10-20T00:00:00Z',
      points: [validPoint],
      days: [],
    };
    expect(deviceHistorySchema.safeParse(valid).success).toBe(true);
    expect(deviceHistorySchema.safeParse({ ...valid, range: '1y' }).success).toBe(false);
    expect(deviceHistorySchema.safeParse({ ...valid, to: '2026-10-20' }).success).toBe(false);
  });

  it('validates the query', () => {
    expect(historyQuerySchema.safeParse({ capability: 'temperature', range: '28d' }).success).toBe(
      true,
    );
    expect(historyQuerySchema.safeParse({ capability: '', range: '28d' }).success).toBe(false);
    expect(historyQuerySchema.safeParse({ capability: 'x', range: '2d' }).success).toBe(false);
  });

  it('maps resolutions to minutes', () => {
    expect(RESOLUTION_MINUTES).toEqual({ '15m': 15, '1h': 60 });
  });
});

describe('wateringEvents', () => {
  it('returns nothing for an empty or single-point series', () => {
    expect(wateringEvents([])).toEqual([]);
    expect(wateringEvents([point(0, 20)])).toEqual([]);
  });

  it('counts a rise of exactly 10 points (default minRise) and not 9', () => {
    expect(wateringEvents([point(0, 20), point(15, 30)])).toEqual([at(15)]);
    expect(wateringEvents([point(0, 20), point(15, 29)])).toEqual([]);
  });

  it('honours a custom minRise', () => {
    expect(wateringEvents([point(0, 20), point(15, 25)], { minRise: 5 })).toEqual([at(15)]);
  });

  it('merges rises within two hours into one event', () => {
    const points = [point(0, 20), point(15, 32), point(30, 33), point(60, 45), point(75, 45)];
    expect(wateringEvents(points)).toEqual([at(15)]);
  });

  it('counts rises more than two hours apart separately', () => {
    const points = [point(0, 20), point(15, 32), point(150, 20), point(165, 35)];
    expect(wateringEvents(points)).toEqual([at(15), at(165)]);
  });

  it('ignores a rise across a gap longer than twice the resolution', () => {
    const points = [point(0, 20), point(15, 20), point(30, 20), point(45, 20), point(120, 40)];
    expect(wateringEvents(points)).toEqual([]);
  });

  it('uses an explicit resolution instead of the inferred step', () => {
    const points = [point(0, 20), point(60, 40)];
    expect(wateringEvents(points, { resolution: '15m' })).toEqual([]);
    expect(wateringEvents(points, { resolution: '1h' })).toEqual([at(60)]);
  });
});

describe('timeBelow', () => {
  it('sums one resolution step per point below the threshold', () => {
    const points = [point(0, 30), point(15, 20), point(30, 10), point(45, 25)];
    expect(timeBelow(points, 25, '15m')).toBe(30);
    expect(timeBelow(points, 25, '1h')).toBe(120);
  });

  it('does not count gaps', () => {
    const points = [point(0, 10), point(300, 10)];
    expect(timeBelow(points, 25, '15m')).toBe(30);
  });

  it('is 0 for an empty series', () => {
    expect(timeBelow([], 25, '15m')).toBe(0);
  });
});

describe('historySummary', () => {
  const points = [
    point(0, 30, { min: 28, max: 31 }),
    point(15, 20, { min: 12, max: 24 }),
    point(30, 40, { min: 35, max: 44 }),
  ];

  it('takes low and high from min and max', () => {
    const summary = historySummary(history(points), 25);
    expect(summary.low).toEqual({ value: 12, t: at(15) });
    expect(summary.high).toEqual({ value: 44, t: at(30) });
    expect(summary.minutesBelow).toBe(15);
  });

  it('has no minutesBelow without a threshold', () => {
    expect(historySummary(history(points), null).minutesBelow).toBeNull();
  });

  it('reports waterings and the last one', () => {
    const summary = historySummary(history(points), null);
    expect(summary.waterings).toEqual([at(30)]);
    expect(summary.lastWatering).toBe(at(30));
  });

  it('handles an empty history', () => {
    expect(historySummary(history([]), 25)).toEqual({
      low: null,
      high: null,
      minutesBelow: 0,
      waterings: [],
      lastWatering: null,
    });
  });
});
