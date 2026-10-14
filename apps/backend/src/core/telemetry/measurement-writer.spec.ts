import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeasurementWriter } from './measurement-writer.js';
import type { MeasurementsRepository } from './measurements.repository.js';
import type { NewMeasurementRow } from './telemetry.schema.js';

const DEVICE = '3f1d6a52-8f0c-4a39-9a59-0c6a0f6f8f11';
const rows = (count: number, from = 0): NewMeasurementRow[] =>
  Array.from({ length: count }, (_, index) => ({
    time: new Date(Date.UTC(2026, 9, 14, 12, 0, from + index)),
    deviceId: DEVICE,
    capability: 'soil_moisture',
    valueNum: from + index,
  }));

describe('MeasurementWriter', () => {
  const insertMany = vi.fn<MeasurementsRepository['insertMany']>();
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  let writer: MeasurementWriter;

  beforeEach(() => {
    vi.useFakeTimers();
    insertMany.mockReset().mockImplementation((batch) => Promise.resolve(batch.length));
    warn.mockClear();
    writer = new MeasurementWriter({ insertMany } as unknown as MeasurementsRepository);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes what it was handed after one second, in one batch', async () => {
    writer.add(rows(2));
    writer.add(rows(1, 2));
    await vi.advanceTimersByTimeAsync(999);
    expect(insertMany).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(insertMany.mock.calls[0]?.[0]).toHaveLength(3);
  });

  it('writes at once when 500 rows are waiting', async () => {
    writer.add(rows(499));
    await vi.advanceTimersByTimeAsync(0);
    expect(insertMany).not.toHaveBeenCalled();

    writer.add(rows(1, 499));
    await vi.advanceTimersByTimeAsync(0);
    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(insertMany.mock.calls[0]?.[0]).toHaveLength(500);

    // The timer of the first rows must not write the (empty) buffer again.
    await vi.advanceTimersByTimeAsync(2000);
    expect(insertMany).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when nothing was added', async () => {
    await vi.advanceTimersByTimeAsync(5000);
    await writer.flush();
    expect(insertMany).not.toHaveBeenCalled();
  });

  it('flushes what is left, and waits for it, when the module is destroyed', async () => {
    let finish: (() => void) | undefined;
    insertMany.mockImplementation(
      (batch) =>
        new Promise((resolve) => {
          finish = () => resolve(batch.length);
        }),
    );
    writer.add(rows(3));
    let done = false;
    const destroyed = writer.onModuleDestroy().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);

    finish?.();
    await destroyed;
    expect(done).toBe(true);
    // The pending timer is gone.
    await vi.advanceTimersByTimeAsync(5000);
    expect(insertMany).toHaveBeenCalledTimes(1);
  });

  it('keeps rows that arrive while a write is running for the next write', async () => {
    let release: (() => void) | undefined;
    insertMany.mockImplementationOnce(
      (batch) =>
        new Promise((resolve) => {
          release = () => resolve(batch.length);
        }),
    );
    writer.add(rows(500));
    await vi.advanceTimersByTimeAsync(0);
    writer.add(rows(2, 500));
    await vi.advanceTimersByTimeAsync(1000);
    expect(insertMany).toHaveBeenCalledTimes(1);

    release?.();
    await vi.advanceTimersByTimeAsync(0);
    await writer.flush();
    expect(insertMany).toHaveBeenCalledTimes(2);
    expect(insertMany.mock.calls[1]?.[0]).toHaveLength(2);
  });

  it('logs a failed write without the readings and carries on', async () => {
    insertMany.mockRejectedValueOnce(new Error('connection refused 3f1d value 42.5'));
    writer.add(rows(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).not.toContain('42.5');
    expect(String(warn.mock.calls[0])).not.toContain(DEVICE);

    writer.add(rows(1, 1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(insertMany).toHaveBeenCalledTimes(2);
  });
});
