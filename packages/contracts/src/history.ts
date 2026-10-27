import * as z from 'zod/mini';
import { localDateSchema, utcInstantSchema } from './time.js';

export const HISTORY_RANGES = ['24h', '7d', '28d'] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];
export const historyRangeSchema = z.enum(HISTORY_RANGES);

export const HISTORY_RESOLUTIONS = ['15m', '1h'] as const;
export type HistoryResolution = (typeof HISTORY_RESOLUTIONS)[number];
export const historyResolutionSchema = z.enum(HISTORY_RESOLUTIONS);

export const RESOLUTION_MINUTES: Record<HistoryResolution, number> = { '15m': 15, '1h': 60 };

const aggregates = {
  avg: z.number(),
  min: z.number(),
  max: z.number(),
  last: z.number(),
};

/** One bucket of a history: aggregates over the bucket starting at `t` (UTC). */
export const historyPointSchema = z.object({ t: utcInstantSchema, ...aggregates });
export type HistoryPoint = z.infer<typeof historyPointSchema>;

/** One calendar day in the household's zone; `partial` if the day is not fully covered. */
export const historyDaySchema = z.object({
  date: localDateSchema,
  ...aggregates,
  partial: z.boolean(),
});
export type HistoryDay = z.infer<typeof historyDaySchema>;

export const deviceHistorySchema = z.object({
  capability: z.string(),
  unit: z.nullable(z.string()),
  range: historyRangeSchema,
  resolution: historyResolutionSchema,
  from: utcInstantSchema,
  to: utcInstantSchema,
  points: z.array(historyPointSchema),
  days: z.array(historyDaySchema),
});
export type DeviceHistory = z.infer<typeof deviceHistorySchema>;

export const historyQuerySchema = z.object({
  capability: z.string().check(z.minLength(1)),
  range: historyRangeSchema,
});
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

const MINUTE_MS = 60_000;
const DEFAULT_MIN_RISE = 10;
/** Rises closer than this to the previous watering belong to the same watering. */
const WATERING_MERGE_MINUTES = 120;

function medianGapMinutes(points: readonly HistoryPoint[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < points.length; i++) {
    gaps.push((Date.parse(points[i]!.t) - Date.parse(points[i - 1]!.t)) / MINUTE_MS);
  }
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 1 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
}

/**
 * Detects waterings in a soil-moisture series: the times (ISO, UTC) of points whose `avg` rose
 * by at least `minRise` (default 10) over the previous point.
 *
 * - A rise only counts between consecutive points at most twice the resolution apart, so a data
 *   gap is never mistaken for a jump. The resolution is `options.resolution` if given, else the
 *   median gap between consecutive points.
 * - Rises within two hours of the previous counted watering merge into that one.
 */
export function wateringEvents(
  points: readonly HistoryPoint[],
  options: { minRise?: number; resolution?: HistoryResolution } = {},
): string[] {
  if (points.length < 2) return [];
  const minRise = options.minRise ?? DEFAULT_MIN_RISE;
  const step = options.resolution
    ? RESOLUTION_MINUTES[options.resolution]
    : medianGapMinutes(points);
  const events: string[] = [];
  let lastEvent: number | null = null;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]!;
    const current = points[i]!;
    const time = Date.parse(current.t);
    const gap = (time - Date.parse(previous.t)) / MINUTE_MS;
    if (gap > 2 * step || current.avg - previous.avg < minRise) continue;
    if (lastEvent !== null && (time - lastEvent) / MINUTE_MS <= WATERING_MERGE_MINUTES) continue;
    events.push(current.t);
    lastEvent = time;
  }
  return events;
}

/**
 * Minutes spent below `threshold`: each point whose `avg` is below it counts one resolution step.
 * Missing buckets (gaps) are not counted.
 */
export function timeBelow(
  points: readonly HistoryPoint[],
  threshold: number,
  resolution: HistoryResolution,
): number {
  return points.filter((p) => p.avg < threshold).length * RESOLUTION_MINUTES[resolution];
}

export interface HistorySummary {
  low: { value: number; t: string } | null;
  high: { value: number; t: string } | null;
  /** Null when there is no threshold. */
  minutesBelow: number | null;
  /** Only meaningful for soil moisture; callers decide whether to show them. */
  waterings: string[];
  lastWatering: string | null;
}

export function historySummary(history: DeviceHistory, threshold: number | null): HistorySummary {
  let low: HistorySummary['low'] = null;
  let high: HistorySummary['high'] = null;
  for (const p of history.points) {
    if (low === null || p.min < low.value) low = { value: p.min, t: p.t };
    if (high === null || p.max > high.value) high = { value: p.max, t: p.t };
  }
  const waterings = wateringEvents(history.points, { resolution: history.resolution });
  return {
    low,
    high,
    minutesBelow:
      threshold === null ? null : timeBelow(history.points, threshold, history.resolution),
    waterings,
    lastWatering: waterings.at(-1) ?? null,
  };
}
