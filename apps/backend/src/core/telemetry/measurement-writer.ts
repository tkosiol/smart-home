import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { describeError } from '../../platform/errors/index.js';
import { MeasurementsRepository } from './measurements.repository.js';
import type { NewMeasurementRow } from './telemetry.schema.js';

const FLUSH_INTERVAL_MS = 1000;
const FLUSH_AT_ROWS = 500;
/** Rows waiting for the database; beyond this the database is not keeping up and the oldest go. */
const MAX_PENDING_ROWS = 10_000;
const DROP_LOG_INTERVAL_MS = 60_000;

/**
 * Collects readings and writes them in batches: every second, or at once when 500 are waiting, so
 * that a busy gateway costs a few statements, not one per reading. A failed batch is logged (error
 * class only, never the readings) and dropped; the writer never blocks the ingest and holds at most
 * 10 000 rows (the oldest are dropped). Destroying the module writes what is left and waits for it;
 * after that the writer takes nothing more.
 */
@Injectable()
export class MeasurementWriter implements OnModuleDestroy {
  private readonly logger = new Logger(MeasurementWriter.name);
  private buffer: NewMeasurementRow[] = [];
  /** Full batches not yet handed to the database, oldest first. */
  private readonly waiting: NewMeasurementRow[][] = [];
  private pendingRows = 0;
  private timer: NodeJS.Timeout | undefined;
  private draining: Promise<void> | undefined;
  private closed = false;
  private dropped = 0;
  private lastDropLog: number | undefined;

  constructor(private readonly repository: MeasurementsRepository) {}

  add(rows: readonly NewMeasurementRow[]): void {
    if (rows.length === 0) return;
    if (this.closed) {
      this.noteDropped(rows.length, 'the writer is closed');
      return;
    }
    this.buffer.push(...rows);
    this.pendingRows += rows.length;
    this.dropOverflow();
    if (this.buffer.length >= FLUSH_AT_ROWS) {
      void this.flush();
    } else if (this.buffer.length > 0) {
      this.timer ??= setTimeout(() => void this.flush(), FLUSH_INTERVAL_MS);
      this.timer.unref();
    }
  }

  /** Writes what is buffered; resolves when that, and every write before it, is done. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.buffer.length > 0) {
      this.waiting.push(this.buffer);
      this.buffer = [];
    }
    // Only with work to do: a drain that finds nothing would end before this assignment.
    if (this.waiting.length > 0) this.draining ??= this.drain();
    return this.draining ?? Promise.resolve();
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    await this.flush();
  }

  /** Writes the waiting batches one after the other, so that a slow database is not hit in parallel. */
  private async drain(): Promise<void> {
    try {
      for (let batch = this.waiting.shift(); batch; batch = this.waiting.shift()) {
        this.pendingRows -= batch.length;
        await this.write(batch);
      }
    } finally {
      this.draining = undefined;
    }
  }

  private async write(batch: NewMeasurementRow[]): Promise<void> {
    try {
      await this.repository.insertMany(batch);
    } catch (error) {
      this.logger.warn(`Cannot store ${batch.length} readings: ${describeError(error)}`);
    }
  }

  /** Throws away the oldest rows beyond the limit: waiting batches first, then the buffer. */
  private dropOverflow(): void {
    let excess = this.pendingRows - MAX_PENDING_ROWS;
    if (excess <= 0) return;
    this.pendingRows = MAX_PENDING_ROWS;
    let count = 0;
    while (excess > 0) {
      const oldest = this.waiting[0];
      if (!oldest) break;
      if (oldest.length <= excess) {
        this.waiting.shift();
        excess -= oldest.length;
        count += oldest.length;
      } else {
        oldest.splice(0, excess);
        count += excess;
        excess = 0;
      }
    }
    if (excess > 0) {
      this.buffer.splice(0, excess);
      count += excess;
    }
    this.noteDropped(count, 'the database is not keeping up');
  }

  /** At most one line per minute (and one for a closed writer), with the rows dropped meanwhile. */
  private noteDropped(count: number, reason: string): void {
    this.dropped += count;
    const now = Date.now();
    if (this.lastDropLog !== undefined && now - this.lastDropLog < DROP_LOG_INTERVAL_MS) return;
    this.lastDropLog = now;
    this.logger.warn(`Dropped ${this.dropped} readings: ${reason}`);
    this.dropped = 0;
  }
}
