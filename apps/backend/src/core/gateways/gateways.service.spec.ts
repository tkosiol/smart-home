import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../platform/config/index.js';
import { createTestCa } from '../../../test/helpers/test-pki.js';
import { GATEWAY_REGISTERED, GATEWAY_REVOKED, GatewayEvents } from './gateway-events.js';
import { noStatusMemory, type RecalledStatus } from './gateway-status-memory.js';
import type { GatewaysRepository } from './gateways.repository.js';
import type { GatewayRow, NewGatewayRow } from './gateways.schema.js';
import { GatewaysService } from './gateways.service.js';

// The throwaway PKI issues certificates around the real clock (valid from one day ago), so this
// clock must follow the real one: a fixed date makes registration fail once a day has passed.
const NOW = new Date();
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
      new GatewayEvents(),
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

  describe('registering while a status arrives', () => {
    it('applies a status that reached the memory between recall and insert', async () => {
      const ca = createTestCa();
      try {
        const issued = ca.issue();
        let calls = 0;
        const recall = vi.fn((): RecalledStatus | undefined => {
          calls += 1;
          return calls === 1
            ? { bridge: 'online', at: NOW }
            : { bridge: 'online', z2m: 'online', at: NOW };
        });
        const applyStatus = vi.fn(() => Promise.resolve('changed' as const));
        const insert = vi.fn((values: NewGatewayRow) =>
          Promise.resolve({ ...row(), ...values, revokedAt: null } as GatewayRow),
        );
        const subject = new GatewaysService(
          { insert, applyStatus } as unknown as GatewaysRepository,
          { GATEWAY_CA_FILE: ca.file } as Env,
          () => NOW,
          { recall },
          new GatewayEvents(),
        );
        const gateway = await subject.register('household', {
          name: 'Pi',
          certificate: issued.certificate,
        });
        expect(applyStatus.mock.calls).toEqual([[issued.id, 'z2m', 'online', NOW]]);
        expect(gateway.bridgeStatus).toBe('online');
        expect(gateway.z2mStatus).toBe('online');
        expect(gateway.statusChangedAt).toBe(NOW.toISOString());
      } finally {
        ca.dispose();
      }
    });

    it('writes nothing more when the memory did not change', async () => {
      const ca = createTestCa();
      try {
        const issued = ca.issue();
        const applyStatus = vi.fn(() => Promise.resolve('changed' as const));
        const subject = new GatewaysService(
          {
            insert: (values: NewGatewayRow) =>
              Promise.resolve({ ...row(), ...values, revokedAt: null } as GatewayRow),
            applyStatus,
          } as unknown as GatewaysRepository,
          { GATEWAY_CA_FILE: ca.file } as Env,
          () => NOW,
          { recall: () => ({ bridge: 'offline', at: NOW }) },
          new GatewayEvents(),
        );
        await subject.register('household', { name: 'Pi', certificate: issued.certificate });
        expect(applyStatus).not.toHaveBeenCalled();
      } finally {
        ca.dispose();
      }
    });
  });
  describe('lifecycle events', () => {
    it('lists the active gateways with their topic prefix', async () => {
      const events = new GatewayEvents();
      const subject = new GatewaysService(
        {
          listActive: () =>
            Promise.resolve([row(), row({ id: 'gw-bbbbbbbb', topicPrefix: 'gw/gw-bbbbbbbb/z2m' })]),
        } as unknown as GatewaysRepository,
        {} as Env,
        () => NOW,
        noStatusMemory,
        events,
      );
      expect(await subject.listActive()).toEqual([
        { id: 'gw-a1b2c3d4', householdId: 'household', topicPrefix: 'gw/gw-a1b2c3d4/z2m' },
        { id: 'gw-bbbbbbbb', householdId: 'household', topicPrefix: 'gw/gw-bbbbbbbb/z2m' },
      ]);
    });

    it('announces a registered gateway after storing it', async () => {
      const ca = createTestCa();
      try {
        const issued = ca.issue();
        const events = new GatewayEvents();
        const seen: unknown[] = [];
        events.on(GATEWAY_REGISTERED, (event) => seen.push(event));
        const subject = new GatewaysService(
          {
            insert: (values: NewGatewayRow) =>
              Promise.resolve({ ...row(), ...values, revokedAt: null } as GatewayRow),
          } as unknown as GatewaysRepository,
          { GATEWAY_CA_FILE: ca.file } as Env,
          () => NOW,
          noStatusMemory,
          events,
        );
        await subject.register('household', { name: 'Pi', certificate: issued.certificate });
        expect(seen).toEqual([{ gatewayId: issued.id, topicPrefix: `gw/${issued.id}/z2m` }]);
      } finally {
        ca.dispose();
      }
    });

    it('announces nothing when the gateway ID is taken', async () => {
      const ca = createTestCa();
      try {
        const events = new GatewayEvents();
        const seen: unknown[] = [];
        events.on(GATEWAY_REGISTERED, (event) => seen.push(event));
        const subject = new GatewaysService(
          { insert: () => Promise.resolve(undefined) } as unknown as GatewaysRepository,
          { GATEWAY_CA_FILE: ca.file } as Env,
          () => NOW,
          noStatusMemory,
          events,
        );
        await expect(
          subject.register('household', { name: 'Pi', certificate: ca.issue().certificate }),
        ).rejects.toThrow();
        expect(seen).toEqual([]);
      } finally {
        ca.dispose();
      }
    });

    it('announces a revoked gateway, but not a revocation that found nothing', async () => {
      const events = new GatewayEvents();
      const seen: unknown[] = [];
      events.on(GATEWAY_REVOKED, (event) => seen.push(event));
      const found = new Map([['gw-a1b2c3d4', true]]);
      const subject = new GatewaysService(
        {
          revoke: (_h: string, id: string) => Promise.resolve(found.has(id)),
        } as unknown as GatewaysRepository,
        {} as Env,
        () => NOW,
        noStatusMemory,
        events,
      );
      await expect(subject.revoke('household', 'gw-zzzzzzzz')).rejects.toThrow();
      expect(seen).toEqual([]);
      await subject.revoke('household', 'gw-a1b2c3d4');
      expect(seen).toEqual([{ gatewayId: 'gw-a1b2c3d4' }]);
    });
  });
});
