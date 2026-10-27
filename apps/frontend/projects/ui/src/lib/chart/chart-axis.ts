export type UiChartRange = '24h' | '7d' | '28d';

export interface ChartAxisLabel {
  /** UTC instant (`…Z`) the label belongs to. */
  readonly t: string;
  readonly text: string;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

export function rangeDurationMs(range: UiChartRange): number {
  return range === '24h' ? DAY : range === '7d' ? 7 * DAY : 28 * DAY;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${timeZone}|${JSON.stringify(options)}`;
  let format = formatters.get(key);
  if (!format)
    formatters.set(key, (format = new Intl.DateTimeFormat(locale, { ...options, timeZone })));
  return format;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface LocalClock {
  readonly weekday: number; // 0 = Sunday
  readonly millisOfDay: number;
}

function localClock(instant: number, timeZone: string): LocalClock {
  const parts = formatter('en-US', timeZone, {
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    weekday: WEEKDAYS.indexOf(value('weekday')),
    millisOfDay:
      Number(value('hour')) * HOUR +
      Number(value('minute')) * MINUTE +
      Number(value('second')) * 1000,
  };
}

/** Minutes since local midnight of an instant in the time zone. */
export function localMinutesOfDay(instant: number, timeZone: string): number {
  return localClock(instant, timeZone).millisOfDay / MINUTE;
}

/** The instant of local midnight at or before `instant`. */
function localMidnight(instant: number, timeZone: string): number {
  return instant - localClock(instant, timeZone).millisOfDay;
}

/** Local midnights from the one at or before `from` up to `to` (days are 23 to 25 hours at DST changes). */
function localDays(from: number, to: number, timeZone: string): { start: number; end: number }[] {
  const days: { start: number; end: number }[] = [];
  let start = localMidnight(from, timeZone);
  while (start < to) {
    const end = localMidnight(start + 36 * HOUR, timeZone);
    days.push({ start, end });
    start = end;
  }
  return days;
}

/** "Heute" / "Today": the locale's own word for the current day, capitalised. */
function todayText(locale: string): string {
  const word = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'day');
  return word.charAt(0).toLocaleUpperCase(locale) + word.slice(1);
}

const iso = (instant: number) => new Date(instant).toISOString();

/** A label this close to "Today" (narrow / wide plot) is left out so the two do not touch. */
const TODAY_CLEARANCE = { narrow: 6 * DAY, wide: 2.5 * DAY };

/**
 * The labels under the time axis, in the household time zone (spec 4.1): 24 h every sixth local
 * hour; 7 days the weekday in the middle of each day that has at least 10 hours in range, "Today"
 * for the last (the weekday when `narrow`); 4 weeks the Mondays (every second one when `narrow`)
 * and "Today" at the right end. Pure, locale and zone through Intl.
 */
export function chartAxisLabels(
  range: UiChartRange,
  from: string,
  to: string,
  timeZone: string,
  narrow: boolean,
  locale: string,
): ChartAxisLabel[] {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!(end > start)) return [];
  const labels: ChartAxisLabel[] = [];

  if (range === '24h') {
    const hour = formatter(locale, timeZone, { hour: 'numeric' });
    const grid = 15 * MINUTE; // every zone's offset is a multiple of 15 minutes
    for (let t = Math.ceil(start / grid) * grid; t <= end; t += grid) {
      const minutes = localMinutesOfDay(t, timeZone);
      if (minutes % 360 === 0)
        labels.push({ t: iso(t), text: hour.format(t).replace(/^0(\d)/, '$1') });
    }
    return labels;
  }

  if (range === '7d') {
    const weekday = formatter(locale, timeZone, { weekday: 'short' });
    for (const day of localDays(start, end, timeZone)) {
      const a = Math.max(day.start, start);
      const b = Math.min(day.end, end);
      if (b - a < 10 * HOUR) continue;
      const text = b === end && !narrow ? todayText(locale) : weekday.format(a).replace(/\.$/, '');
      labels.push({ t: iso((a + b) / 2), text });
    }
    return labels;
  }

  const date = formatter(locale, timeZone, { day: 'numeric', month: 'short' });
  const clearance = narrow ? TODAY_CLEARANCE.narrow : TODAY_CLEARANCE.wide;
  let mondays = 0;
  for (const day of localDays(start, end, timeZone)) {
    if (day.start < start || localClock(day.start, timeZone).weekday !== 1) continue;
    const shown = !narrow || mondays % 2 === 0;
    mondays++;
    if (shown && end - day.start >= clearance) {
      labels.push({ t: iso(day.start), text: date.format(day.start) });
    }
  }
  labels.push({ t: iso(end), text: todayText(locale) });
  return labels;
}
