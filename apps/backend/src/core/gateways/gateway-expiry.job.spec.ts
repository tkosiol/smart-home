import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayExpiryJob } from './gateway-expiry.job.js';
import type { GatewaysRepository } from './gateways.repository.js';
import type { GatewayRow } from './gateways.schema.js';
import type { GatewaysService } from './gateways.service.js';

const NOW = new Date('2026-10-14T04:00:00Z');
const inDays = (days: number): Date => new Date(NOW.getTime() + days * 86_400_000);
const row = (id: string, certExpiresAt: Date): GatewayRow =>
  ({ id, certExpiresAt, revokedAt: null }) as GatewayRow;

describe('GatewayExpiryJob', () => {
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  const job = (rows: GatewayRow[], crl: Date | undefined | Error): GatewayExpiryJob =>
    new GatewayExpiryJob(
      { listActive: () => Promise.resolve(rows) } as unknown as GatewaysRepository,
      {
        crlNextUpdate: () => (crl instanceof Error ? Promise.reject(crl) : Promise.resolve(crl)),
      } as unknown as GatewaysService,
      () => NOW,
    );
  const warnings = (): string[] => warn.mock.calls.map(String);

  afterEach(() => {
    warn.mockClear();
    error.mockClear();
  });

  it('reports certificates that expire within 30 days or have expired', async () => {
    const report = await job(
      [
        row('gw-00000001', inDays(400)),
        row('gw-00000002', inDays(29)),
        row('gw-00000003', inDays(-2)),
        row('gw-00000004', inDays(30)),
      ],
      inDays(200),
    ).run();
    expect(report.certificates).toEqual([
      { id: 'gw-00000002', expiresAt: inDays(29), expired: false },
      { id: 'gw-00000003', expiresAt: inDays(-2), expired: true },
    ]);
    expect(report.crlExpiring).toBe(false);
    const lines = warnings();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('gw-00000002');
    expect(lines[0]).toContain(inDays(29).toISOString());
    expect(lines[1]).toContain('gw-00000003');
    expect(lines[1]).toContain('expired');
  });

  it('reports a CRL that must be renewed within 30 days', async () => {
    const report = await job([], inDays(12)).run();
    expect(report.crlExpiring).toBe(true);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain(inDays(12).toISOString());
  });

  it('says once that the CRL cannot be checked when its date is not available', async () => {
    const report = await job([row('gw-00000001', inDays(100))], undefined).run();
    expect(report.crlExpiring).toBe(false);
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain('CRL');
  });

  it('stays quiet when everything is fine', async () => {
    await job([row('gw-00000001', inDays(100))], inDays(100)).run();
    expect(warn).not.toHaveBeenCalled();
  });

  it('logs a failed run without its reason and does not throw', async () => {
    await expect(job([], new Error('secret path /x')).runScheduled()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).not.toContain('secret');
  });
});
