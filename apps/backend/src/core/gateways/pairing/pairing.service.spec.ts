import { Logger } from '@nestjs/common';
import { displayNameSchema, GATEWAY_ID_PATTERN, PAIRING_CODE_PATTERN } from '@smart/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../platform/config/index.js';
import type { GatewayCredentials } from '../credentials/gateway-credentials.service.js';
import { GATEWAY_REGISTERED, GatewayEvents } from '../gateway-events.js';
import type { GatewaysRepository } from '../gateways.repository.js';
import type { GatewayRow, NewGatewayRow } from '../gateways.schema.js';
import type { GatewayPairingsRepository } from './gateway-pairings.repository.js';
import type { GatewayPairingRow } from './gateway-pairings.schema.js';
import { hashPairingCode, normalizePairingCode } from './pairing-code.js';
import { MAX_PAIRED_GATEWAYS, PAIRING_TTL_MS, PairingService } from './pairing.service.js';

const NOW = new Date('2026-11-20T10:00:00Z');
const HOUSEHOLD = '6f1f7c3e-3a51-4c1e-9a43-5a0d6c8e2b10';
const OTHER_HOUSEHOLD = '0b8d2a55-2a35-4d3b-8a0e-3cb0d1f6e7a2';
const USER = '2f6d1c0b-7f3c-4a29-9f35-0e6f3b8b1d44';
const MINUTE_MS = 60_000;

const gatewayRow = (overrides: Partial<GatewayRow> = {}): GatewayRow => ({
  id: 'gw-hacred01',
  householdId: HOUSEHOLD,
  name: 'Home Assistant',
  kind: 'ha',
  auth: 'credentials',
  credentialGeneration: 1,
  topicPrefix: 'gw/gw-hacred01/ha',
  bridgeStatus: 'unknown',
  serviceStatus: 'unknown',
  statusChangedAt: null,
  lastMessageAt: null,
  certFingerprint: null,
  certExpiresAt: null,
  createdAt: NOW,
  revokedAt: null,
  ...overrides,
});

const codeError = (promise: Promise<unknown>): Promise<string> =>
  promise.then(
    () => 'ok',
    (error: unknown) => {
      const { code, status } = error as { code?: string; status?: number };
      return code ? `${String(status)} ${code}` : String(error);
    },
  );

/**
 * The database as two lists; a transaction works on them and puts them back when it throws, as a
 * rollback would.
 */
class FakeDatabase {
  pairings: GatewayPairingRow[] = [];
  gateways: GatewayRow[] = [];
  /** How many inserts to come find their ID taken (by a gateway of another household, say). */
  collisions = 0;
  inserts: string[] = [];

  readonly pairingsRepository = {
    replaceOpen: (values: {
      householdId: string;
      gatewayId: string | null;
      codeHash: string;
      createdBy: string;
      now: Date;
      expiresAt: Date;
    }): Promise<void> => {
      for (const row of this.pairings) {
        const sameTarget =
          row.householdId === values.householdId && row.gatewayId === values.gatewayId;
        if (sameTarget && row.usedAt === null && row.expiresAt > values.now) {
          row.expiresAt = values.now;
        }
      }
      this.pairings.push({
        id: `pairing-${this.pairings.length + 1}`,
        householdId: values.householdId,
        gatewayId: values.gatewayId,
        codeHash: values.codeHash,
        createdBy: values.createdBy,
        createdAt: values.now,
        expiresAt: values.expiresAt,
        usedAt: null,
      });
      return Promise.resolve();
    },
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const pairings = structuredClone(this.pairings);
      const gateways = structuredClone(this.gateways);
      try {
        return await fn('tx');
      } catch (error) {
        this.pairings = pairings;
        this.gateways = gateways;
        throw error;
      }
    },
    lockOpen: (_tx: unknown, codeHash: string, now: Date) =>
      Promise.resolve(
        this.pairings.find(
          (row) => row.codeHash === codeHash && row.usedAt === null && row.expiresAt > now,
        ),
      ),
    markUsed: (_tx: unknown, id: string, now: Date) => {
      const row = this.pairings.find((entry) => entry.id === id);
      if (row) row.usedAt = now;
      return Promise.resolve();
    },
  };

  readonly gatewaysRepository = {
    findById: (id: string) => Promise.resolve(this.gateways.find((row) => row.id === id)),
    countActiveCredentials: (householdId: string) =>
      Promise.resolve(
        this.gateways.filter(
          (row) =>
            row.householdId === householdId && row.auth === 'credentials' && row.revokedAt === null,
        ).length,
      ),
    insert: (values: NewGatewayRow) => {
      this.inserts.push(values.id);
      if (this.collisions > 0 || this.gateways.some((row) => row.id === values.id)) {
        this.collisions -= 1;
        return Promise.resolve(undefined);
      }
      const row = gatewayRow({ ...values });
      this.gateways.push(row);
      return Promise.resolve(row);
    },
    nextGeneration: (_tx: unknown, id: string) => {
      const row = this.gateways.find(
        (entry) => entry.id === id && entry.auth === 'credentials' && entry.revokedAt === null,
      );
      if (!row?.credentialGeneration) return Promise.resolve(undefined);
      row.credentialGeneration += 1;
      return Promise.resolve(row.credentialGeneration);
    },
  };
}

/** The broker steps the service asks for, in order. */
class FakeCredentials {
  enabled = true;
  readonly steps: string[] = [];
  failWith: Error | undefined;
  readonly exclusive = vi.fn(<T>(fn: () => Promise<T>): Promise<T> => fn());

  password(id: string, generation: number): string {
    return `key-${id}-${String(generation)}`;
  }

  create(id: string, generation: number): Promise<void> {
    return this.step(`create ${id} ${String(generation)}`);
  }

  rekey(id: string, generation: number): Promise<void> {
    return this.step(`rekey ${id} ${String(generation)}`);
  }

  private step(name: string): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.steps.push(name);
    return Promise.resolve();
  }
}

describe('PairingService', () => {
  let db: FakeDatabase;
  let credentials: FakeCredentials;
  let events: GatewayEvents;
  let registered: unknown[];
  let now: Date;
  let origin: string;
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  const service = (): PairingService =>
    new PairingService(
      db.pairingsRepository as unknown as GatewayPairingsRepository,
      db.gatewaysRepository as unknown as GatewaysRepository,
      credentials as unknown as GatewayCredentials,
      events,
      { APP_ORIGIN: origin } as Env,
      () => now,
    );
  const createCode = async (gatewayId?: string, household = HOUSEHOLD): Promise<string> =>
    (await service().create(household, USER, gatewayId === undefined ? {} : { gatewayId })).code;
  const hashOf = (code: string): string => hashPairingCode(normalizePairingCode(code) ?? '');
  const pairingOf = (code: string): GatewayPairingRow | undefined =>
    db.pairings.find((row) => row.codeHash === hashOf(code));

  beforeEach(() => {
    db = new FakeDatabase();
    credentials = new FakeCredentials();
    events = new GatewayEvents();
    registered = [];
    events.on(GATEWAY_REGISTERED, (event) => registered.push(event));
    now = NOW;
    origin = 'https://smart.example.org';
  });

  afterEach(() => {
    warn.mockClear();
  });

  describe('create', () => {
    it('returns a code valid for 15 minutes with the address of the app; stores only its hash', async () => {
      const pairing = await service().create(HOUSEHOLD, USER, {});
      expect(pairing.code).toMatch(PAIRING_CODE_PATTERN);
      expect(pairing.expiresAt).toBe(new Date(NOW.getTime() + PAIRING_TTL_MS).toISOString());
      expect(PAIRING_TTL_MS).toBe(15 * MINUTE_MS);
      expect(pairing.appUrl).toBe('https://smart.example.org');
      expect(db.pairings).toEqual([
        expect.objectContaining({
          householdId: HOUSEHOLD,
          gatewayId: null,
          codeHash: hashOf(pairing.code),
          createdBy: USER,
        }),
      ]);
      expect(JSON.stringify(db.pairings)).not.toContain(pairing.code.replace('-', ''));
    });

    it('voids the open codes of the same target, and only those', async () => {
      db.gateways.push(gatewayRow());
      const first = await createCode();
      const forGateway = await createCode('gw-hacred01');
      const otherHousehold = await createCode(undefined, OTHER_HOUSEHOLD);
      now = new Date(NOW.getTime() + MINUTE_MS);
      const second = await createCode();

      expect(pairingOf(first)?.expiresAt).toEqual(now);
      expect(pairingOf(forGateway)?.expiresAt).toEqual(new Date(NOW.getTime() + PAIRING_TTL_MS));
      expect(pairingOf(otherHousehold)?.expiresAt).toEqual(
        new Date(NOW.getTime() + PAIRING_TTL_MS),
      );
      expect(pairingOf(second)?.expiresAt).toEqual(new Date(now.getTime() + PAIRING_TTL_MS));
    });

    it('pairs anew only a credentials gateway of the household that is not revoked', async () => {
      db.gateways.push(
        gatewayRow({ id: 'gw-foreign1', householdId: OTHER_HOUSEHOLD }),
        gatewayRow({ id: 'gw-revoked1', revokedAt: NOW }),
        gatewayRow({
          id: 'gw-certpi01',
          kind: 'z2m',
          auth: 'certificate',
          credentialGeneration: null,
          certFingerprint: 'fingerprint',
          certExpiresAt: NOW,
        }),
      );
      for (const id of ['gw-foreign1', 'gw-revoked1', 'gw-certpi01', 'gw-unknown1']) {
        expect(await codeError(service().create(HOUSEHOLD, USER, { gatewayId: id }))).toBe(
          '404 household.notFound',
        );
      }
      expect(db.pairings).toEqual([]);
    });

    it(`refuses a code for a new gateway once the household has ${String(MAX_PAIRED_GATEWAYS)}`, async () => {
      expect(MAX_PAIRED_GATEWAYS).toBe(5);
      for (let i = 1; i <= 4; i++) db.gateways.push(gatewayRow({ id: `gw-hacred0${String(i)}` }));
      // Revoked and certificate gateways do not count.
      db.gateways.push(gatewayRow({ id: 'gw-revoked1', revokedAt: NOW }));
      expect(await codeError(service().create(HOUSEHOLD, USER, {}))).toBe('ok');
      db.gateways.push(gatewayRow({ id: 'gw-hacred05' }));
      expect(await codeError(service().create(HOUSEHOLD, USER, {}))).toBe(
        '409 gateway.limitReached',
      );
      // Pairing an existing one anew stays possible.
      expect(await codeError(service().create(HOUSEHOLD, USER, { gatewayId: 'gw-hacred05' }))).toBe(
        'ok',
      );
    });
    it('answers 503 without the secret and hands out no code that could never be redeemed', async () => {
      db.gateways.push(gatewayRow());
      credentials.enabled = false;
      expect(await codeError(service().create(HOUSEHOLD, USER, {}))).toBe(
        '503 gateway.pairingUnavailable',
      );
      expect(await codeError(service().create(HOUSEHOLD, USER, { gatewayId: 'gw-hacred01' }))).toBe(
        '503 gateway.pairingUnavailable',
      );
      expect(db.pairings).toEqual([]);
    });
  });

  describe('redeem', () => {
    it('creates a gateway of the kind ha with credentials, the broker user and announces it', async () => {
      const code = await createCode();
      now = new Date(NOW.getTime() + MINUTE_MS);
      const redeemed = await service().redeem({ code, name: 'Ferienhaus' });

      expect(redeemed.gatewayId).toMatch(GATEWAY_ID_PATTERN);
      const id = redeemed.gatewayId;
      expect(redeemed).toEqual({
        gatewayId: id,
        mqttUrl: 'wss://smart.example.org/mqtt',
        username: id,
        password: `key-${id}-1`,
        clientId: `${id}-ha`,
      });
      expect(db.gateways).toEqual([
        expect.objectContaining({
          id,
          householdId: HOUSEHOLD,
          name: 'Ferienhaus',
          kind: 'ha',
          auth: 'credentials',
          credentialGeneration: 1,
          topicPrefix: `gw/${id}/ha`,
          certFingerprint: null,
          certExpiresAt: null,
          createdAt: now,
        }),
      ]);
      expect(credentials.steps).toEqual([`create ${id} 1`]);
      expect(credentials.exclusive).toHaveBeenCalledTimes(1);
      expect(registered).toEqual([{ gatewayId: id, kind: 'ha', topicPrefix: `gw/${id}/ha` }]);
      expect(pairingOf(code)?.usedAt).toEqual(now);
    });

    it('names the gateway Home Assistant without a name', async () => {
      await service().redeem({ code: await createCode() });
      expect(db.gateways.map((row) => row.name)).toEqual(['Home Assistant']);
    });

    it.each([
      ['trimmed', '  Ferienhaus  ', 'Ferienhaus'],
      ['without control characters', '\tHaus\nam See\u007f', 'Hausam See'],
      ['cut to 60 characters', 'x'.repeat(80), 'x'.repeat(60)],
      ['cut, without a blank at the end', `${'a'.repeat(59)} bcd`, 'a'.repeat(59)],
      ['cut between characters, not within one', '😀'.repeat(40), '😀'.repeat(30)],
      ['Home Assistant when blank', '   ', 'Home Assistant'],
      ['Home Assistant when empty', '', 'Home Assistant'],
      ['Home Assistant when only control characters', '\n\t\u0000', 'Home Assistant'],
    ])('makes a valid display name of the location name: %s', async (_case, name, expected) => {
      await service().redeem({ code: await createCode(), name });
      const stored = db.gateways.map((row) => row.name);
      expect(stored).toEqual([expected]);
      expect(displayNameSchema.safeParse(stored[0]).success).toBe(true);
    });

    it('derives the MQTT address from the origin of the app', async () => {
      origin = 'http://localhost:4200';
      const redeemed = await service().redeem({ code: await createCode() });
      expect(redeemed.mqttUrl).toBe('ws://localhost:4200/mqtt');
    });

    it('accepts the code in any spelling', async () => {
      const code = await createCode();
      const sloppy = ` ${code.toLowerCase().replace('-', ' ')} `;
      expect(await codeError(service().redeem({ code: sloppy }))).toBe('ok');
    });

    it('draws a new ID when the drawn one is taken, up to 5 times', async () => {
      const code = await createCode();
      db.collisions = 4;
      const redeemed = await service().redeem({ code });
      expect(db.inserts).toHaveLength(5);
      expect(new Set(db.inserts).size).toBe(5);
      expect(db.inserts.at(-1)).toBe(redeemed.gatewayId);

      const next = await createCode();
      db.collisions = 5;
      db.inserts = [];
      expect(await codeError(service().redeem({ code: next }))).not.toBe('ok');
      expect(db.inserts).toHaveLength(5);
      expect(pairingOf(next)?.usedAt).toBeNull();
    });

    it('pairs an existing gateway anew: next generation, new key at the broker, no announcement', async () => {
      db.gateways.push(gatewayRow({ credentialGeneration: 3 }));
      const code = await createCode('gw-hacred01');
      const redeemed = await service().redeem({ code, expectedGatewayId: 'gw-hacred01' });

      expect(redeemed).toEqual({
        gatewayId: 'gw-hacred01',
        mqttUrl: 'wss://smart.example.org/mqtt',
        username: 'gw-hacred01',
        password: credentials.password('gw-hacred01', 4),
        clientId: 'gw-hacred01-ha',
      });
      expect(db.gateways.map((row) => row.credentialGeneration)).toEqual([4]);
      expect(credentials.steps).toEqual(['rekey gw-hacred01 4']);
      expect(registered).toEqual([]);
    });

    it('pairs an existing gateway anew without an expected gateway, as a new entry in Home Assistant does', async () => {
      db.gateways.push(gatewayRow({ credentialGeneration: 3 }));
      const code = await createCode('gw-hacred01');
      const redeemed = await service().redeem({ code, name: 'Zuhause' });

      expect(redeemed.gatewayId).toBe('gw-hacred01');
      expect(redeemed.password).toBe(credentials.password('gw-hacred01', 4));
      expect(db.gateways).toEqual([gatewayRow({ credentialGeneration: 4 })]);
      expect(credentials.steps).toEqual(['rekey gw-hacred01 4']);
      expect(registered).toEqual([]);
    });

    it('answers 409 without using the code when it belongs to another target', async () => {
      db.gateways.push(gatewayRow(), gatewayRow({ id: 'gw-hacred02' }));
      const forGateway = await createCode('gw-hacred01');
      const forNew = await createCode();

      for (const [code, expected] of [
        [forGateway, 'gw-hacred02'],
        [forNew, 'gw-hacred01'],
      ] as const) {
        expect(await codeError(service().redeem({ code, expectedGatewayId: expected }))).toBe(
          '409 gateway.pairingOtherGateway',
        );
      }
      expect(credentials.steps).toEqual([]);
      expect(db.pairings.map((row) => row.usedAt)).toEqual([null, null]);
      // Still valid for the right target.
      expect(await codeError(service().redeem({ code: forNew }))).toBe('ok');
    });

    it('answers expired, used, unknown and malformed codes all alike with 404', async () => {
      const expired = await createCode();
      now = new Date(NOW.getTime() + PAIRING_TTL_MS);
      const used = await createCode(undefined, OTHER_HOUSEHOLD);
      await service().redeem({ code: used });
      credentials.steps.length = 0;

      for (const code of [expired, used, 'ABCD-EFGH', 'K7QM-4XWU', '????']) {
        expect(await codeError(service().redeem({ code }))).toBe('404 gateway.pairingInvalid');
      }
      expect(credentials.steps).toEqual([]);
    });

    it('answers 404 for a code whose gateway was revoked meanwhile', async () => {
      db.gateways.push(gatewayRow());
      const code = await createCode('gw-hacred01');
      const [gateway] = db.gateways;
      if (gateway) gateway.revokedAt = NOW;
      expect(await codeError(service().redeem({ code }))).toBe('404 gateway.pairingInvalid');
      expect(credentials.steps).toEqual([]);
    });

    it('checks the limit again when the code is redeemed', async () => {
      const code = await createCode();
      for (let i = 1; i <= 5; i++) db.gateways.push(gatewayRow({ id: `gw-hacred0${String(i)}` }));
      expect(await codeError(service().redeem({ code }))).toBe('409 gateway.limitReached');
      expect(db.gateways).toHaveLength(5);
      expect(pairingOf(code)?.usedAt).toBeNull();
    });

    it('stores nothing and keeps the code valid when the broker step fails', async () => {
      db.gateways.push(gatewayRow());
      const forNew = await createCode();
      const forGateway = await createCode('gw-hacred01');
      credentials.failWith = new Error('timeout');

      expect(await codeError(service().redeem({ code: forNew }))).toBe(
        '503 gateway.pairingUnavailable',
      );
      expect(await codeError(service().redeem({ code: forGateway }))).toBe(
        '503 gateway.pairingUnavailable',
      );
      expect(db.gateways).toEqual([gatewayRow()]);
      expect(db.pairings.map((row) => row.usedAt)).toEqual([null, null]);
      expect(registered).toEqual([]);

      credentials.failWith = undefined;
      expect(await codeError(service().redeem({ code: forNew }))).toBe('ok');
    });

    it('answers 503 without the secret and keeps the code valid', async () => {
      const code = await createCode();
      credentials.enabled = false;
      expect(await codeError(service().redeem({ code }))).toBe('503 gateway.pairingUnavailable');
      expect(db.gateways).toEqual([]);
      expect(pairingOf(code)?.usedAt).toBeNull();
      expect(credentials.steps).toEqual([]);
    });

    it('never logs the code or the key', async () => {
      const code = await createCode();
      credentials.failWith = new Error('timeout');
      await codeError(service().redeem({ code }));
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toContain(code.replace('-', ''));
      expect(logged).not.toContain('key-');
    });
  });
});
