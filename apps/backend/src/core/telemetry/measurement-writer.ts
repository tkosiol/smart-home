import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { describeError } from '../../platform/errors/index.js';
import { MeasurementsRepository } from './measurements.repository.js';
import type { NewMeasurementRow } from './telemetry.schema.js';

const FLUSH_INTERVAL_MS = 1000;
const FLUSH_AT_ROWS = 500;

/**
 * Collects readings and writes them in batches: every second, or at once when 500 are waiting, so
 * that a busy gateway costs a few statements, not one per reading. A failed batch is logged (error
 * class only, never the readings) and dropped; the writer never blocks the ingest. Destroying the
 * module writes what is left and waits for it.
 */
@Injectable()
export class MeasurementWriter implements OnModuleDestroy {
  private readonly logger = new Logger(MeasurementWriter.name);
  private buffer: NewMeasurementRow[] = [];
  private timer: NodeJS.Timeout | undefined;
  /** Writes run one after the other, so that a slow database is not hit with parallel batches. */
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly repository: MeasurementsRepository) {}

  add(rows: readonly NewMeasurementRow[]): void {
    if (rows.length === 0) return;
    this.buffer.push(...rows);
    if (this.buffer.length >= FLUSH_AT_ROWS) {
      void this.flush();
    } else {
      this.timer ??= setTimeout(() => void this.flush(), FLUSH_INTERVAL_MS);
    }
  }

  /** Writes what is buffered; resolves when that, and every write before it, is done. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const batch = this.buffer;
    this.buffer = [];
    if (batch.length > 0) {
      this.tail = this.tail.then(() => this.write(batch));
    }
    return this.tail;
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }

  private async write(batch: NewMeasurementRow[]): Promise<void> {
    try {
      await this.repository.insertMany(batch);
    } catch (error) {
      this.logger.warn(`Cannot store ${batch.length} readings: ${describeError(error)}`);
    }
  }
}
