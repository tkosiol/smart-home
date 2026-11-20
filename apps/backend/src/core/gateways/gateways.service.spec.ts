import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ApiError } from '../../platform/http/index.js';
import type { Env } from '../../platform/config/index.js';
import { createTestCa } from '../../../test/helpers/test-pki.js';
import {
  GATEWAY_REGISTERED,
  GATEWAY_REVOKED,
  GATEWAY_TOUCHED,
  GatewayEvents,
} from './gateway-events.js';
import { AdapterRegistry, type GatewayAdapter } from '../adapters/index.js';
import type { GatewayCredentials } from './credentials/gateway-credentials.service.js';
import { noStatusMemory, type RecalledStatus } from './gateway-status-memory.js';
import type { GatewaysRepository } from './gateways.repository.js';
import type { GatewayRow, NewGatewayRow } from './gateways.schema.js';
import { GatewaysService } from './gateways.service.js';

// The throwaway PKI issues certificates around the real clock (valid from one day ago), so this
// clock must follow the real one: a fixed date makes registration fail once a day has passed.
const NOW = new Date();
const fakeAdapter = (kind: string): GatewayAdapter => ({ kind }) as unknown as GatewayAdapter;
const registry = new AdapterRegistry([fakeAdapter('z2m')]);
const noCredentials = {
  exclusive: <T>(fn: () => Promise<T>) => fn(),
  remove: () => Promise.resolve(),
} as unknown as GatewayCredentials;
const row = (overrides: Partial<GatewayRow> = {}): GatewayRow => ({
  id: 'gw-a1b2c3d4',
  householdId: 'household',
  name: 'Pi',
  kind: 'z2m',
  auth: 'certificate',
  credentialGeneration: null,
  topicPrefix: 'gw/gw-a1b2c3d4/z2m',
  bridgeStatus: 'unknown',
  serviceStatus: 'unknown',
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
      registry,
      noCredentials,
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

  it('lists the credential generation of a paired gateway and null for a certificate one', async () => {
    const paired = row({
      id: 'gw-hacred01',
      kind: 'ha',
      auth: 'credentials',
      credentialGeneration: 3,
      certFingerprint: null,
      certExpiresAt: null,
    });
    const listed = await service(undefined, [row(), paired]).list('household');
    expect(listed.map((gateway) => gateway.credentialGeneration)).toEqual([null, 3]);
  });

  describe('find', () => {
    const withLookup = (rows: GatewayRow[]): GatewaysService =>
      new GatewaysService(
        {
          findById: (id: string) => Promise.resolve(rows.find((r) => r.id === id)),
        } as unknown as GatewaysRepository,
        {} as Env,
        () => now,
        noStatusMemory,
        new GatewayEvents(),
        registry,
        noCredentials,
      );

    it('returns the gateway with its household, a revoked one too', async () => {
      const subject = withLookup([
        row(),
        row({ id: 'gw-bbbbbbbb', householdId: 'other', revokedAt: NOW }),
      ]);
      expect((await subject.find('gw-a1b2c3d4'))?.householdId).toBe('household');
      expect((await subject.find('gw-a1b2c3d4'))?.gateway).toMatchObject({ id: 'gw-a1b2c3d4' });
      const revoked = await subject.find('gw-bbbbbbbb');
      expect(revoked?.householdId).toBe('other');
      expect(revoked?.gateway.revokedAt).toBe(NOW.toISOString());
    });

    it('returns undefined for an unknown ID', async () => {
      expect(await withLookup([row()]).find('gw-cccccccc')).toBeUndefined();
    });
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
            : { bridge: 'online', service: 'online', serviceKind: 'z2m', at: NOW };
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
          registry,
          noCredentials,
        );
        const gateway = await subject.register('household', {
          name: 'Pi',
          certificate: issued.certificate,
        });
        expect(applyStatus.mock.calls).toEqual([[issued.id, 'service', 'online', NOW, 'z2m']]);
        expect(gateway.bridgeStatus).toBe('online');
        expect(gateway.serviceStatus).toBe('online');
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
          registry,
          noCredentials,
        );
        await subject.register('household', { name: 'Pi', certificate: issued.certificate });
        expect(applyStatus).not.toHaveBeenCalled();
      } finally {
        ca.dispose();
      }
    });
  });
  describe('the kind', () => {
    const registering = async (
      kind: 'z2m' | undefined,
      options: { adapters?: GatewayAdapter[]; recalled?: RecalledStatus } = {},
    ) => {
      const ca = createTestCa();
      try {
        const insert = vi.fn((values: NewGatewayRow) =>
          Promise.resolve({ ...row(), ...values, revokedAt: null } as GatewayRow),
        );
        const subject = new GatewaysService(
          { insert, applyStatus: vi.fn() } as unknown as GatewaysRepository,
          { GATEWAY_CA_FILE: ca.file } as Env,
          () => NOW,
          { recall: () => options.recalled },
          new GatewayEvents(),
          new AdapterRegistry(options.adapters ?? [fakeAdapter('z2m')]),
          noCredentials,
        );
        const issued = ca.issue();
        const result = await subject
          .register('household', {
            name: 'Pi',
            ...(kind && { kind }),
            certificate: issued.certificate,
          })
          .then((gateway) => ({ gateway, error: undefined }))
          .catch((error: unknown) => ({ gateway: undefined, error }));
        return { id: issued.id, insert, ...result };
      } finally {
        ca.dispose();
      }
    };

    it.each([undefined, 'z2m' as const])(
      'registers kind %s as z2m under gw/<id>/z2m',
      async (kind) => {
        const { id, insert } = await registering(kind);
        expect(insert).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'z2m', topicPrefix: `gw/${id}/z2m` }),
        );
      },
    );

    it('refuses a kind that has no adapter with validation.failed and stores nothing', async () => {
      const { insert, error } = await registering('z2m', { adapters: [] });
      expect(error).toMatchObject({ code: 'validation.failed' });
      expect((error as ApiError).getStatus()).toBe(400);
      expect(insert).not.toHaveBeenCalled();
    });

    it('does not take over a service status heard from another kind of gateway', async () => {
      const { insert } = await registering('z2m', {
        recalled: {
          bridge: 'online',
          service: 'online',
          serviceKind: 'xx' as 'z2m',
          at: NOW,
        },
      });
      const values = insert.mock.calls[0]?.[0];
      expect(values).toMatchObject({ bridgeStatus: 'online' });
      expect(values).not.toHaveProperty('serviceStatus');
    });

    it('takes over a service status heard under the same kind', async () => {
      const { insert } = await registering('z2m', {
        recalled: { service: 'online', serviceKind: 'z2m', at: NOW },
      });
      expect(insert.mock.calls[0]?.[0]).toMatchObject({ serviceStatus: 'online' });
    });
  });

  describe('lifecycle events', () => {
    it('lists the active gateways with their kind and topic prefix', async () => {
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
        registry,
        noCredentials,
      );
      expect(await subject.listActive()).toEqual([
        {
          id: 'gw-a1b2c3d4',
          householdId: 'household',
          kind: 'z2m',
          topicPrefix: 'gw/gw-a1b2c3d4/z2m',
        },
        {
          id: 'gw-bbbbbbbb',
          householdId: 'household',
          kind: 'z2m',
          topicPrefix: 'gw/gw-bbbbbbbb/z2m',
        },
      ]);
    });

    it('records a sign of life and announces it only when the gateway is registered', async () => {
      const events = new GatewayEvents();
      const seen: unknown[] = [];
      events.on(GATEWAY_TOUCHED, (event) => seen.push(event));
      const touch = vi.fn<GatewaysRepository['touch']>().mockResolvedValueOnce(true);
      touch.mockResolvedValueOnce(false);
      const subject = new GatewaysService(
        { touch } as unknown as GatewaysRepository,
        {} as Env,
        () => NOW,
        noStatusMemory,
        events,
        registry,
        noCredentials,
      );
      expect(await subject.touch('gw-a1b2c3d4', NOW)).toBe(true);
      expect(await subject.touch('gw-gone0000', NOW)).toBe(false);
      expect(touch.mock.calls).toEqual([
        ['gw-a1b2c3d4', NOW],
        ['gw-gone0000', NOW],
      ]);
      expect(seen).toEqual([{ gatewayId: 'gw-a1b2c3d4' }]);
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
          registry,
          noCredentials,
        );
        await subject.register('household', { name: 'Pi', certificate: issued.certificate });
        expect(seen).toEqual([
          { gatewayId: issued.id, kind: 'z2m', topicPrefix: `gw/${issued.id}/z2m` },
        ]);
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
          registry,
          noCredentials,
        );
        await expect(
          subject.register('household', { name: 'Pi', certificate: ca.issue().certificate }),
        ).rejects.toThrow();
        expect(seen).toEqual([]);
      } finally {
        ca.dispose();
      }
    });

    describe('revoke', () => {
      const revokeFixture = (rows: GatewayRow[], removal: Error | undefined = undefined) => {
        const events = new GatewayEvents();
        const seen: unknown[] = [];
        events.on(GATEWAY_REVOKED, (event) => seen.push(event));
        const revoked: string[] = [];
        /** Broker removals, each with whether it ran inside an exclusive section. */
        const removed: { id: string; exclusive: boolean }[] = [];
        let inExclusive = false;
        const credentials = {
          exclusive: async <T>(fn: () => Promise<T>): Promise<T> => {
            inExclusive = true;
            try {
              return await fn();
            } finally {
              inExclusive = false;
            }
          },
          remove: (id: string) => {
            removed.push({ id, exclusive: inExclusive });
            return removal ? Promise.reject(removal) : Promise.resolve();
          },
        } as unknown as GatewayCredentials;
        const subject = new GatewaysService(
          {
            findById: (id: string) => Promise.resolve(rows.find((entry) => entry.id === id)),
            revoke: (_h: string, id: string) => {
              revoked.push(id);
              return Promise.resolve(true);
            },
          } as unknown as GatewaysRepository,
          {} as Env,
          () => NOW,
          noStatusMemory,
          events,
          registry,
          credentials,
        );
        return { subject, seen, revoked, removed };
      };
      const credentials = row({
        id: 'gw-hacred01',
        kind: 'ha',
        auth: 'credentials',
        credentialGeneration: 1,
        certFingerprint: null,
        certExpiresAt: null,
      });
      const certificate = row({ id: 'gw-a1b2c3d4' });
      const code = (promise: Promise<void>) =>
        promise.then(
          () => 'ok',
          (error: unknown) => (error as { code?: string }).code ?? String(error),
        );

      it('announces a revoked gateway, but not a revocation that found nothing', async () => {
        const { subject, seen } = revokeFixture([certificate]);
        const admin = { platformAdmin: true };
        await expect(subject.revoke('household', 'gw-zzzzzzzz', admin)).rejects.toThrow();
        expect(seen).toEqual([]);
        await subject.revoke('household', 'gw-a1b2c3d4', admin);
        expect(seen).toEqual([{ gatewayId: 'gw-a1b2c3d4' }]);
      });

      it('does not touch a gateway of another household', async () => {
        const { subject, revoked } = revokeFixture([certificate]);
        expect(await code(subject.revoke('other', 'gw-a1b2c3d4', { platformAdmin: true }))).toBe(
          'household.notFound',
        );
        expect(revoked).toEqual([]);
      });

      it('needs a platform admin for a certificate, but not for credentials', async () => {
        const { subject, seen, revoked } = revokeFixture([certificate, credentials]);
        const owner = { platformAdmin: false };
        expect(await code(subject.revoke('household', 'gw-a1b2c3d4', owner))).toBe(
          'auth.forbidden',
        );
        expect(revoked).toEqual([]);
        expect(await code(subject.revoke('household', 'gw-hacred01', owner))).toBe('ok');
        expect(revoked).toEqual(['gw-hacred01']);
        expect(seen).toEqual([{ gatewayId: 'gw-hacred01' }]);
      });

      it('removes the broker user of a revoked credentials gateway, not of a certificate one', async () => {
        const { subject, removed } = revokeFixture([certificate, credentials]);
        await subject.revoke('household', 'gw-a1b2c3d4', { platformAdmin: true });
        expect(removed).toEqual([]);
        await subject.revoke('household', 'gw-hacred01', { platformAdmin: false });
        expect(removed).toEqual([{ id: 'gw-hacred01', exclusive: true }]);
      });

      it('logs a failed removal at the broker instead of failing the revocation', async () => {
        const { subject, seen, revoked } = revokeFixture([credentials], new Error('timeout'));
        expect(
          await code(subject.revoke('household', 'gw-hacred01', { platformAdmin: false })),
        ).toBe('ok');
        expect(revoked).toEqual(['gw-hacred01']);
        expect(seen).toEqual([{ gatewayId: 'gw-hacred01' }]);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('gw-hacred01');
      });
    });
  });
});
