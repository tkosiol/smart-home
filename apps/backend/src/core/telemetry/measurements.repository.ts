import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type DatabaseConnection } from '../../platform/database/index.js';
import { measurements, type NewMeasurementRow } from './telemetry.schema.js';

/** Rows per statement: well below the parameter limit of one query (6 values per row). */
const BATCH_SIZE = 5000;

@Injectable()
export class MeasurementsRepository {
  constructor(@Inject(DATABASE) private readonly connection: DatabaseConnection) {}

  /**
   * Stores readings; one that exists already (same device, capability and time) is left as it is,
   * so a message delivered twice leaves no duplicate. Returns how many rows were new.
   */
  async insertMany(rows: readonly NewMeasurementRow[]): Promise<number> {
    let inserted = 0;
    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const stored = await this.connection.db
        .insert(measurements)
        .values(rows.slice(offset, offset + BATCH_SIZE))
        .onConflictDoNothing()
        .returning({ time: measurements.time });
      inserted += stored.length;
    }
    return inserted;
  }

  /**
   * Start of the uninterrupted run of readings below `below` that ends with the latest reading:
   * the first such reading after the latest reading at or above `clearAt` (for a value with a
   * hysteresis, `clearAt` is the threshold plus the margin, so readings in between do not end the
   * run). Looks back to `from` only, so that it stays within a few chunks; a run that reaches
   * `from` starts at its first reading there. `null` when no reading below `below` is stored.
   */
  async runStart(
    deviceId: string,
    capability: string,
    below: number,
    clearAt: number,
    from: Date,
  ): Promise<Date | null> {
    const fromIso = from.toISOString();
    const [row] = await this.connection.sql<{ start: Date | string | null }[]>`
      select min(time) as start
      from measurements
      where device_id = ${deviceId} and capability = ${capability}
        and value_num < ${below} and time >= ${fromIso}::timestamptz
        and time > coalesce((
          select max(time) from measurements
          where device_id = ${deviceId} and capability = ${capability}
            and value_num >= ${clearAt} and time >= ${fromIso}::timestamptz
        ), '-infinity'::timestamptz)`;
    // The driver is configured to return timestamps as strings.
    return row?.start == null ? null : new Date(row.start);
  }
}
