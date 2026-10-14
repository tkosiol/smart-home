import { sql } from 'drizzle-orm';
import { doublePrecision, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Readings of devices. A TimescaleDB hypertable (chunks of 7 days, compressed after 7 days, dropped
 * after one year): the migration turns it into one with hand-written SQL, drizzle cannot express
 * that. No foreign key to devices: hypertables do not take them, retention cleans up.
 * `binary` readings are 0/1 in `value_num`, `enum` readings are text.
 */
export const measurements = pgTable(
  'measurements',
  {
    time: timestamp('time', { withTimezone: true, mode: 'date' }).notNull(),
    deviceId: uuid('device_id').notNull(),
    capability: text('capability').notNull(),
    valueNum: doublePrecision('value_num'),
    valueText: text('value_text'),
    /** Remarks on the reading, e.g. `time_replaced` when the receive time stands in for it. */
    flags: text('flags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (table) => [
    // A hypertable's unique index must contain the time column.
    uniqueIndex('measurements_device_capability_time_idx').on(
      table.deviceId,
      table.capability,
      table.time,
    ),
  ],
);

export type MeasurementRow = typeof measurements.$inferSelect;
export type NewMeasurementRow = typeof measurements.$inferInsert;
