import { z } from 'zod';

/**
 * A point in time, transported as ISO 8601 in UTC with a trailing `Z`
 * (e.g. `2026-10-25T01:30:00Z`). Offsets and zone-less values are rejected.
 */
export const utcInstantSchema = z.iso.datetime();
export type UtcInstant = z.infer<typeof utcInstantSchema>;

/**
 * A calendar date without time or zone (`YYYY-MM-DD`).
 * Never convert it to a `Date`: that would shift it by the runtime's offset.
 */
export const localDateSchema = z.iso.date().refine(isExistingCalendarDate, {
  message: 'Invalid calendar date',
});
export type LocalDate = z.infer<typeof localDateSchema>;

function isExistingCalendarDate(value: string): boolean {
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
