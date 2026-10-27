import { marker } from '@jsverse/transloco-keys-manager/marker';
import {
  historySummary,
  primaryCapability,
  RESOLUTION_MINUTES,
  type Capability,
  type Device,
  type DeviceHistory,
  type HistoryRange,
} from '@smart/contracts';
import type { UiChartKind, UiChartPoint } from '@smart/ui';
import { formatNumber, isReading } from './device-values';

/** Keeps the unit on the line of its number. */
const NBSP = String.fromCharCode(0xa0);
const SOIL = 'soil_moisture';
/** Soil moisture is drawn on a fixed scale, so a dry and a wet plant look the same everywhere. */
const SOIL_DOMAIN = { min: 0, max: 80 } as const;
const DAY_MINUTES = 1440;
/** After the main value come these, in this order, then everything else. */
const CHIP_ORDER = ['temperature', 'humidity', 'battery'] as const;

/** The words of the line under the chart and of the table notes (root keys, marked here). */
const SUMMARY_KEYS = {
  low: marker('app.devices.history.summary.low'),
  high: marker('app.devices.history.summary.high'),
  dryHours: marker('app.devices.history.summary.dryHours'),
  dryMinutes: marker('app.devices.history.summary.dryMinutes'),
  waterings: marker('app.devices.history.summary.waterings'),
} as const;

export const NOTE_KEYS = {
  dry: marker('app.devices.history.note.dry'),
  watered: marker('app.devices.history.note.watered'),
  both: marker('app.devices.history.note.both'),
} as const;

export const DRY_KEY = marker('app.devices.history.dry');

/** The long names of the ranges for the chart's name and description. */
export const SPAN_KEYS: Readonly<Record<HistoryRange, string>> = {
  '24h': marker('app.devices.history.span.24h'),
  '7d': marker('app.devices.history.span.7d'),
  '28d': marker('app.devices.history.span.28d'),
};

/** The names of the ranges (root keys, so the segmented button can be given translated labels). */
export const RANGE_KEYS: Readonly<Record<HistoryRange, string>> = {
  '24h': marker('app.devices.history.range.24h'),
  '7d': marker('app.devices.history.range.7d'),
  '28d': marker('app.devices.history.range.28d'),
};

/** The readings a history can be drawn for: numeric measurements, the main value first (spec 4.3). */
export function historyCapabilities(device: Pick<Device, 'capabilities'>): Capability[] {
  const numeric = device.capabilities.filter(
    (capability) => isReading(capability) && capability.kind === 'numeric',
  );
  const main = primaryCapability(numeric);
  const rank = (capability: Capability): number => {
    if (capability === main) return 0;
    const index = CHIP_ORDER.indexOf(capability.key as (typeof CHIP_ORDER)[number]);
    return index < 0 ? CHIP_ORDER.length + 1 : index + 1;
  };
  // `sort` is stable: the rest keeps the order the device lists them in.
  return [...numeric].sort((a, b) => rank(a) - rank(b));
}

/** The limit a reading is "too dry" below: the device's effective soil minimum, for soil only. */
export function thresholdFor(
  device: Pick<Device, 'effectiveThresholds'>,
  key: string,
): number | null {
  return key === SOIL ? device.effectiveThresholds.soilMoistureMin : null;
}

/** A number in the language's format with its unit. */
export function withUnit(value: number, unit: string | null, locale: string): string {
  const number = formatNumber(value, locale);
  return unit ? `${number}${NBSP}${unit}` : number;
}

/** What `ui-chart` is given for one history. */
export interface ChartView {
  readonly kind: UiChartKind;
  readonly points: readonly UiChartPoint[];
  readonly resolutionMinutes: number;
  readonly domain: { min: number; max: number } | null;
  /** The threshold below which the chart shades "too dry"; null draws no band. */
  readonly band: number | null;
  readonly markers: readonly string[];
}

/** Noon of a calendar day in a zone as an instant: where the chart puts that day's value. */
function dayMiddle(date: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(year, month - 1, day, 12);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(guess);
  const at = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const shown = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour'), at('minute'));
  return new Date(guess - (shown - guess)).toISOString();
}

/**
 * How a history is drawn (spec 4.3): soil moisture as an area on 0 to 80 % with the "too dry" band
 * (only with a threshold) and the waterings as rings; temperature and humidity as an area, over
 * 4 weeks a ribbon of low to high per day; the battery as steps of its last value; the rest as an
 * area.
 */
export function chartViewOf(
  history: DeviceHistory,
  threshold: number | null,
  timeZone = 'UTC',
): ChartView {
  const soil = history.capability === SOIL;
  const resolutionMinutes = RESOLUTION_MINUTES[history.resolution];
  if (history.capability === 'battery') {
    return {
      kind: 'step',
      points: history.points.map((point) => ({ t: point.t, value: point.last })),
      resolutionMinutes,
      domain: null,
      band: null,
      markers: [],
    };
  }
  if (history.range === '28d' && !soil) {
    const ribbon = history.capability === 'temperature' || history.capability === 'humidity';
    if (ribbon && history.days.length > 0) {
      return {
        kind: 'ribbon',
        points: history.days.map((day) => ({
          t: dayMiddle(day.date, timeZone),
          value: day.avg,
          min: day.min,
          max: day.max,
        })),
        resolutionMinutes: DAY_MINUTES,
        domain: null,
        band: null,
        markers: [],
      };
    }
  }
  return {
    kind: 'area',
    points: history.points.map((point) => ({ t: point.t, value: point.avg })),
    resolutionMinutes,
    domain: soil ? SOIL_DOMAIN : null,
    band: soil ? threshold : null,
    markers: soil ? historySummary(history, threshold).waterings : [],
  };
}

/** One piece of the line under the chart: a translation key with its parameters. */
export interface SummaryPart {
  readonly key: string;
  readonly params: Readonly<Record<string, string | number>>;
}

/** "Tief 20 % · Hoch 55 % · 24 Std. zu trocken · 4× gegossen": only what applies. */
export function summaryOf(
  history: DeviceHistory,
  threshold: number | null,
  locale: string,
): SummaryPart[] {
  if (history.points.length === 0) return [];
  const summary = historySummary(history, threshold);
  const soil = history.capability === SOIL;
  const parts: SummaryPart[] = [];
  if (summary.low) {
    parts.push({
      key: SUMMARY_KEYS.low,
      params: { value: withUnit(summary.low.value, history.unit, locale) },
    });
  }
  if (summary.high) {
    parts.push({
      key: SUMMARY_KEYS.high,
      params: { value: withUnit(summary.high.value, history.unit, locale) },
    });
  }
  if (soil && threshold !== null && summary.minutesBelow !== null && summary.minutesBelow > 0) {
    parts.push(
      summary.minutesBelow < 60
        ? { key: SUMMARY_KEYS.dryMinutes, params: { n: summary.minutesBelow } }
        : { key: SUMMARY_KEYS.dryHours, params: { n: Math.round(summary.minutesBelow / 60) } },
    );
  }
  if (soil && summary.waterings.length > 0) {
    parts.push({ key: SUMMARY_KEYS.waterings, params: { n: summary.waterings.length } });
  }
  return parts;
}

const hourCycles = new Map<string, boolean>();

/** Whether the language counts hours 0 to 23 (then midnight ends a bucket as "24"). */
function countsTo24(locale: string): boolean {
  let known = hourCycles.get(locale);
  if (known === undefined) {
    known =
      new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle === 'h23';
    hourCycles.set(locale, known);
  }
  return known;
}

/**
 * The time a point stands for, in household time: the bucket ("Fr., 23. Okt., 23–24 Uhr", "Fr.,
 * 23. Okt., 14:15–14:30") or, for a daily value, the day ("Mo., 5. Okt.").
 */
export function pointLabel(
  t: string,
  resolutionMinutes: number,
  locale: string,
  timeZone: string,
): string {
  const start = Date.parse(t);
  const date = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(start);
  if (resolutionMinutes >= DAY_MINUTES) return date;
  const end = start + resolutionMinutes * 60_000;
  const hourly = resolutionMinutes % 60 === 0;
  const timeFormat = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: hourly ? 'numeric' : '2-digit',
    minute: hourly ? undefined : '2-digit',
    hourCycle: hourly && countsTo24(locale) ? 'h24' : undefined,
  });
  // A bucket that ends at midnight would make `formatRange` add both dates: join the two times
  // ("23 Uhr–24 Uhr").
  const time =
    localDate(t, timeZone) === localDate(new Date(end).toISOString(), timeZone)
      ? timeFormat.formatRange(start, end)
      : `${timeFormat.format(start)}–${timeFormat.format(end)}`;
  return `${date}, ${time}`;
}

/** The calendar day of an instant in a zone, `YYYY-MM-DD`. */
function localDate(t: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(Date.parse(t));
}

/** One line of the table; `notes` become the second line ("zeitweise zu trocken · gegossen"). */
export interface TableRow {
  readonly key: string;
  readonly headline: string;
  readonly value: string;
  readonly notes: readonly ('dry' | 'watered')[];
}

/**
 * The values as a table, newest first: 24 hours and 7 days per bucket (time, value), 4 weeks per
 * day (day, mean, low to high) with a note on days that were too dry or had a watering.
 */
export function tableRowsOf(
  history: DeviceHistory,
  threshold: number | null,
  waterings: readonly string[],
  locale: string,
  timeZone: string,
): TableRow[] {
  const { unit } = history;
  if (history.range === '28d' && history.days.length > 0) {
    const wateredDays = new Set(waterings.map((t) => localDate(t, timeZone)));
    return history.days
      .map((day): TableRow => {
        const notes: ('dry' | 'watered')[] = [];
        if (threshold !== null && day.min < threshold) notes.push('dry');
        if (wateredDays.has(day.date)) notes.push('watered');
        return {
          key: day.date,
          headline: pointLabel(dayMiddle(day.date, timeZone), DAY_MINUTES, locale, timeZone),
          value: `${withUnit(day.avg, unit, locale)} · ${formatNumber(day.min, locale)}–${withUnit(day.max, unit, locale)}`,
          notes,
        };
      })
      .reverse();
  }
  const minutes = RESOLUTION_MINUTES[history.resolution];
  return history.points
    .map((point): TableRow => ({
      key: point.t,
      headline: pointLabel(point.t, minutes, locale, timeZone),
      value: withUnit(point.avg, unit, locale),
      notes: [],
    }))
    .reverse();
}
