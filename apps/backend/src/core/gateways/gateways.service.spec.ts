import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../platform/config/index.js';
import { noStatusMemory } from './gateway-status-memory.js';
import type { GatewaysRepository } from './gateways.repository.js';
import type { GatewayRow } from './gateways.schema.js';
import { GatewaysService } from './gateways.service.js';

const NOW = new Date('2026-10-14T12:00:00Z');
const row = (overrides: Partial<GatewayRow> = {}): GatewayRow => ({
  id: 'gw-a1b2c3d4',
  householdId: 'household',
  name: 'Pi',
  kind: 'z2m',
  topicPrefix: 'gw/gw-a1b2c3d4/z2m',
  bridgeStatus: 'unknown',
  z2mStatus: 'unknown',
  statusChangedAt: null,
  lastMessageAt: null,
  certFingerprint: 'fingerprint',
  certExpiresAt: new Date(NOW.getTime() + 5 * 86_400_000),
  createdAt: NOW,
  revokedAt: null,
  ...overrides,
});

describe('GatewaysService', () => {
  let dir: string;
  let now = NOW;
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const service = (file: string | undefined, rows: GatewayRow[]): GatewaysService =>
    new GatewaysService(
      { listByHousehold: () => Promise.resolve(rows) } as unknown as GatewaysRepository,
      { GATEWAY_CRL_NEXT_UPDATE_FILE: file } as Env,
      () => now,
      noStatusMemory,
    );

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'smart-gateways-spec-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    warn.mockRestore();
  });
  afterEach(() => {
    now = NOW;
    warn.mockClear();
  });

  it('warns once an hour, without details, when the CRL file cannot be read', async () => {
    const subject = service(join(dir, 'missing'), [row()]);
    await subject.list('household');
    await subject.list('household');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain(dir);
    now = new Date(NOW.getTime() + 3_600_001);
    await subject.list('household');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('warns about a CRL file that holds no date, and still lists', async () => {
    writeFileSync(join(dir, 'garbage'), 'soon');
    const listed = await service(join(dir, 'garbage'), [row()]).list('household');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(listed.map((gateway) => gateway.warnings)).toEqual([['certExpiring']]);
  });

  it('stays quiet without a configured file', async () => {
    await service(undefined, [row()]).list('household');
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves out the certificate warnings of a revoked gateway but keeps the CRL warning', async () => {
    writeFileSync(join(dir, 'soon'), new Date(NOW.getTime() + 86_400_000).toISOString());
    const revoked = row({ id: 'gw-bbbbbbbb', revokedAt: NOW });
    const listed = await service(join(dir, 'soon'), [row(), revoked]).list('household');
    expect(listed.map((gateway) => gateway.warnings)).toEqual([
      ['certExpiring', 'crlExpiring'],
      ['crlExpiring'],
    ]);
  });
});
