import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GatewayPairingsRepository } from './gateway-pairings.repository.js';
import { PairingCleanupJob } from './pairing-cleanup.job.js';

const NOW = new Date('2026-11-20T03:50:00Z');
const DAY_MS = 86_400_000;

describe('PairingCleanupJob', () => {
  const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

  afterEach(() => {
    log.mockClear();
    error.mockClear();
  });

  it('deletes the codes used or expired over 7 days ago', async () => {
    const deleteSettledBefore = vi.fn(() => Promise.resolve(3));
    const job = new PairingCleanupJob(
      { deleteSettledBefore } as unknown as GatewayPairingsRepository,
      () => NOW,
    );
    expect(await job.run()).toBe(3);
    expect(deleteSettledBefore).toHaveBeenCalledWith(new Date(NOW.getTime() - 7 * DAY_MS));
  });

  it('logs how many it removed, and a failure without throwing', async () => {
    const deleteSettledBefore = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(2)
      .mockRejectedValueOnce(new Error('database down'));
    const job = new PairingCleanupJob(
      { deleteSettledBefore } as unknown as GatewayPairingsRepository,
      () => NOW,
    );
    await job.runScheduled();
    expect(String(log.mock.calls[0]?.[0])).toContain('2');
    await expect(job.runScheduled()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
