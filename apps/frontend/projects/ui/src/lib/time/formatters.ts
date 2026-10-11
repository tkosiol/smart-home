import { utcInstantSchema } from '@smart/contracts';

export type UiDateTimeStyle = 'short' | 'medium' | 'date' | 'time';

const STYLE_OPTIONS: Record<UiDateTimeStyle, Intl.DateTimeFormatOptions> = {
  short: { dateStyle: 'short', timeStyle: 'short' },
  medium: { dateStyle: 'medium', timeStyle: 'short' },
  date: { dateStyle: 'medium' },
  time: { timeStyle: 'short' },
};

const cache = new Map<string, Intl.DateTimeFormat | Intl.RelativeTimeFormat>();

function dateFormat(
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `d|${locale}|${timeZone}|${JSON.stringify(options)}`;
  let format = cache.get(key) as Intl.DateTimeFormat | undefined;
  if (!format) cache.set(key, (format = new Intl.DateTimeFormat(locale, { ...options, timeZone })));
  return format;
}

function relativeFormat(locale: string): Intl.RelativeTimeFormat {
  const key = `r|${locale}`;
  let format = cache.get(key) as Intl.RelativeTimeFormat | undefined;
  if (!format) cache.set(key, (format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })));
  return format;
}

/** Milliseconds since epoch for a valid UTC instant (`…Z`), otherwise null. */
function parseInstant(value: string | null | undefined): number | null {
  if (value == null || !utcInstantSchema.safeParse(value).success) return null;
  return Date.parse(value);
}

export function formatDateTime(
  value: string | null | undefined,
  style: UiDateTimeStyle,
  locale: string,
  timeZone: string,
): string {
  const instant = parseInstant(value);
  return instant === null ? '' : dateFormat(locale, timeZone, STYLE_OPTIONS[style]).format(instant);
}

/** Calendar day number of an instant in the given time zone (days since 1970-01-01 there). */
function dayNumber(instant: number, timeZone: string): number {
  const parts = dateFormat('en-US', timeZone, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000;
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;

export function formatRelativeTime(
  value: string | null | undefined,
  now: number,
  locale: string,
  timeZone: string,
): string {
  const instant = parseInstant(value);
  if (instant === null) return '';
  const format = relativeFormat(locale);
  const seconds = (instant - now) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 45) return format.format(0, 'second');
  if (abs < 45 * MINUTE) return format.format(Math.round(seconds / MINUTE), 'minute');
  if (abs < 22 * HOUR) return format.format(Math.round(seconds / HOUR), 'hour');
  const days = dayNumber(instant, timeZone) - dayNumber(now, timeZone);
  if (Math.abs(days) < 7) return format.format(days, 'day');
  if (abs < 30 * DAY) return format.format(Math.round(seconds / (7 * DAY)), 'week');
  if (abs < 365 * DAY) return format.format(Math.round(seconds / (30.436875 * DAY)), 'month');
  return format.format(Math.round(seconds / (365.2425 * DAY)), 'year');
}
