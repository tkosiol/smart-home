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
}
