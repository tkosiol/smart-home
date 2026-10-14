import { X509Certificate } from 'node:crypto';
import fs, { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { apiErrorSchema, gatewaySchema, meSchema, type Gateway } from '@smart/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { inject, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { GATEWAY_STATUS_MEMORY } from '../src/core/gateways/index.js';
import { SESSION_COOKIE, SessionService, UsersRepository } from '../src/core/identity/index.js';
import { ENV, type Env } from '../src/platform/config/index.js';
import {
  DATABASE,
  type DatabaseConnection,
  runMigrations,
} from '../src/platform/database/index.js';
import { MQTT_CONNECTION, type MqttConnection } from '../src/platform/mqtt/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';
import { createTestCa, type TestCa } from './helpers/test-pki.js';

const HOUSEHOLDS = '/api/v1/households';
const UNKNOWN_ID = '3b241101-e2bb-4255-8caf-4136c566a962';
const DAY_MS = 86_400_000;

interface TestUser {
  id: string;
  cookie: string;
}

describe('gateways', () => {
  let app: INestApplication<App>;
  let connection: DatabaseConnection;
  let ca: TestCa;
  let foreignCa: TestCa;
  let dir: string;
  let counter = 0;
  const originalEnv = { ...process.env };
  const originalUrl = inject('testEnv').DATABASE_URL;
  const origin = inject('testEnv').APP_ORIGIN;
  /** Everything the process wrote to stdout, stderr or fd 1 (pino): the request and error logs. */
  const written: string[] = [];
  const recall = vi.fn<(id: string) => unknown>(() => undefined);

  let admin: TestUser;
  let ownerWithoutAdmin: TestUser;
  let member: TestUser;
  let householdId: string;
  let otherHouseholdId: string;

  const signedIn = async (platformAdmin = false): Promise<TestUser> => {
    const email = `gateways${(counter += 1)}@example.org`;
    const users = app.get(UsersRepository);
    const user = await users.create({ email, displayName: `User ${counter}` });
    if (platformAdmin) await users.setPlatformAdmin(user.id);
    const { token } = await app.get(SessionService).create(user.id, 'email_code', 'Browser/1');
    return { id: user.id, cookie: `${SESSION_COOKIE}=${token}` };
  };
  const createHousehold = async (owner: TestUser): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post(HOUSEHOLDS)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send({ name: 'Home', timezone: 'Europe/Berlin' })
      .expect(201);
    const id = meSchema.parse(response.body).currentHouseholdId;
    if (!id) throw new Error('no current household');
    return id;
  };
  const addMember = async (id: string, user: TestUser, role: string): Promise<void> => {
    await connection.sql`
      insert into memberships (household_id, user_id, role) values (${id}, ${user.id}, ${role})`;
  };
  const register = (user: TestUser, household: string, certificate: string, name = 'Pi') =>
    request(app.getHttpServer())
      .post(`${HOUSEHOLDS}/${household}/gateways`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .send({ name, certificate });
  const list = (user: TestUser, household: string) =>
    request(app.getHttpServer())
      .get(`${HOUSEHOLDS}/${household}/gateways`)
      .set('Cookie', user.cookie)
      .set('Origin', origin);
  const revoke = (user: TestUser, household: string, id: string) =>
    request(app.getHttpServer())
      .post(`${HOUSEHOLDS}/${household}/gateways/${id}/revoke`)
      .set('Cookie', user.cookie)
      .set('Origin', origin);
  const errorCode = (response: request.Response): string =>
    apiErrorSchema.parse(response.body).code;
  const gatewayCount = async (): Promise<number> => {
    const rows = await connection.sql<
      { count: number }[]
    >`select count(*)::int as count from gateways`;
    return rows[0]?.count ?? 0;
  };
  const env = (): { GATEWAY_CA_FILE?: string; GATEWAY_CRL_NEXT_UPDATE_FILE?: string } =>
    app.get<Env>(ENV);

  beforeAll(async () => {
    ca = createTestCa();
    foreignCa = createTestCa('Test CA');
    dir = mkdtempSync(join(tmpdir(), 'smart-gateways-test-'));
    const url = await createFreshDatabase(originalUrl);
    await runMigrations(url);
    process.env.DATABASE_URL = url;
    process.env.GATEWAY_CA_FILE = ca.file;
    process.env.GATEWAY_CRL_NEXT_UPDATE_FILE = join(dir, 'crl-next-update');
    // The log check below needs the request log of pino, which the other tests silence.
    process.env.LOG_LEVEL = 'info';
    const capture = (chunk: unknown): void => {
      written.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString());
    };
    vi.spyOn(fs, 'writeSync').mockImplementation((_fd: number, chunk: unknown) => {
      capture(chunk);
      return typeof chunk === 'string' ? Buffer.byteLength(chunk) : (chunk as Uint8Array).length;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      capture(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      capture(chunk);
      return true;
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GATEWAY_STATUS_MEMORY)
      .useValue({ recall })
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    configureApp(app);
    await app.init();
    await app.get<MqttConnection>(MQTT_CONNECTION).waitUntilConnected(5000);
    connection = app.get<DatabaseConnection>(DATABASE);
    admin = await signedIn(true);
    ownerWithoutAdmin = await signedIn();
    member = await signedIn();
    householdId = await createHousehold(admin);
    otherHouseholdId = await createHousehold(admin);
    await addMember(householdId, ownerWithoutAdmin, 'owner');
    await addMember(householdId, member, 'member');
  });

  afterAll(async () => {
    await app.close();
    vi.restoreAllMocks();
    for (const name of [
      'DATABASE_URL',
      'GATEWAY_CA_FILE',
      'GATEWAY_CRL_NEXT_UPDATE_FILE',
      'LOG_LEVEL',
    ]) {
      const original = originalEnv[name];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
    ca.dispose();
    foreignCa.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    recall.mockReset();
    recall.mockReturnValue(undefined);
  });

  describe('registration', () => {
    it('stores id, expiry and fingerprint of a valid certificate', async () => {
      const issued = ca.issue();
      const response = await register(
        admin,
        householdId,
        issued.certificate,
        'Living room Pi',
      ).expect(201);
      const gateway = gatewaySchema.parse(response.body);
      const x509 = new X509Certificate(issued.certificate);
      expect(gateway).toEqual({
        id: issued.id,
        name: 'Living room Pi',
        kind: 'z2m',
        topicPrefix: `gw/${issued.id}/z2m`,
        bridgeStatus: 'unknown',
        z2mStatus: 'unknown',
        statusChangedAt: null,
        lastMessageAt: null,
        certExpiresAt: new Date(x509.validTo).toISOString(),
        revokedAt: null,
        warnings: [],
      });
      const [row] = await connection.sql<{ household_id: string; cert_fingerprint: string }[]>`
        select household_id, cert_fingerprint from gateways where id = ${issued.id}`;
      expect(row).toEqual({ household_id: householdId, cert_fingerprint: x509.fingerprint256 });
    });

    it('accepts CRLF line breaks and blank lines around the block', async () => {
      const issued = ca.issue();
      const pasted = `\n\n${issued.certificate.trim().replaceAll('\n', '\r\n')}\r\n\r\n`;
      await register(admin, householdId, pasted).expect(201);
    });

    it('applies the status the memory recalls for the id', async () => {
      const issued = ca.issue();
      const at = new Date('2026-10-14T08:00:00Z');
      recall.mockImplementation((id) =>
        id === issued.id ? { bridge: 'online', z2m: 'offline', at } : undefined,
      );
      const response = await register(admin, householdId, issued.certificate).expect(201);
      expect(gatewaySchema.parse(response.body)).toMatchObject({
        bridgeStatus: 'online',
        z2mStatus: 'offline',
        statusChangedAt: at.toISOString(),
      });
      const listed = await list(admin, householdId).expect(200);
      expect(
        (listed.body as Gateway[]).find((gateway) => gateway.id === issued.id)?.bridgeStatus,
      ).toBe('online');
    });

    it('keeps "unknown" for the part the memory does not know', async () => {
      const issued = ca.issue();
      recall.mockReturnValue({ bridge: 'offline' });
      const response = await register(admin, householdId, issued.certificate).expect(201);
      expect(gatewaySchema.parse(response.body)).toMatchObject({
        bridgeStatus: 'offline',
        z2mStatus: 'unknown',
      });
      expect(gatewaySchema.parse(response.body).statusChangedAt).not.toBeNull();
    });

    describe('with a certificate that must be rejected', () => {
      const cases: Record<string, () => string> = {
        'a chain of two certificates': () => `${ca.issue().certificate}${ca.issue().certificate}`,
        'a certificate followed by its private key': () => {
          const issued = ca.issue();
          return `${issued.certificate}\n${issued.privateKey}`;
        },
        'an expired certificate': () => ca.issue({ startsInDays: -10, endsInDays: -1 }).certificate,
        'a certificate that is not valid yet': () =>
          ca.issue({ startsInDays: 1, endsInDays: 30 }).certificate,
        'a certificate of another CA': () => foreignCa.issue().certificate,
        'the common name smart-api': () => ca.issue({ subject: '/CN=smart-api' }).certificate,
        'a common name with capital letters': () =>
          ca.issue({ subject: '/CN=GW-A1B2C3D4' }).certificate,
        'the CA certificate itself': () => ca.certificate,
        'a server certificate with a gateway name': () =>
          ca.issue({
            subject: '/CN=gw-a1b2c3d4',
            extensions: 'basicConstraints = CA:false\nextendedKeyUsage = serverAuth\n',
          }).certificate,
        'a CA certificate with a gateway name': () =>
          ca.issue({
            subject: '/CN=gw-a1b2c3d4',
            extensions: 'basicConstraints = critical, CA:true\nextendedKeyUsage = clientAuth\n',
          }).certificate,
        'a certificate without extended key usage': () =>
          ca.issue({
            subject: '/CN=gw-a1b2c3d4',
            extensions: 'basicConstraints = CA:false\n',
          }).certificate,
        'text that is no certificate': () => 'hello',
      };

      it.each(Object.keys(cases))('answers 400 for %s and stores nothing', async (name) => {
        const pem = cases[name]?.() ?? '';
        const before = await gatewayCount();
        const response = await register(admin, householdId, pem).expect(400);
        expect(errorCode(response)).toBe('gateway.invalidCertificate');
        expect(await gatewayCount()).toBe(before);
      });
    });

    it('writes nothing of the pasted certificate to the log', async () => {
      const issued = ca.issue({ subject: '/CN=smart-api' });
      const bodyLines = issued.certificate
        .split('\n')
        .filter((line) => line.length > 20 && !line.startsWith('-----'));
      written.length = 0;
      await register(admin, householdId, issued.certificate).expect(400);
      const output = written.join('');
      expect(output).toContain('/gateways'); // the request log was captured
      for (const line of bodyLines) expect(output).not.toContain(line);
    });

    it('writes nothing of the pasted text to the log when the CA is missing', async () => {
      const issued = ca.issue();
      const pasted = `${issued.certificate}\n${issued.privateKey}`;
      const bodyLines = pasted
        .split('\n')
        .filter((line) => line.length > 20 && !line.startsWith('-----'));
      const configured = env().GATEWAY_CA_FILE;
      written.length = 0;
      // The testing module silences Nest's own logger: record what the service would log.
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => {
        written.push(JSON.stringify(args));
      });
      try {
        env().GATEWAY_CA_FILE = join(dir, 'does-not-exist.crt');
        await register(admin, householdId, pasted).expect(503);
      } finally {
        env().GATEWAY_CA_FILE = configured;
        warn.mockRestore();
      }
      const output = written.join('');
      expect(output).toContain('Cannot read the gateway CA certificate'); // the warning was captured
      for (const line of bodyLines) expect(output).not.toContain(line);
    });

    it('registers a gateway ID only once when two requests race', async () => {
      const issued = ca.issue();
      const responses = await Promise.all([
        register(admin, householdId, issued.certificate),
        register(admin, otherHouseholdId, issued.certificate),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      const loser = responses.find((response) => response.status === 409);
      expect(errorCode(loser as request.Response)).toBe('gateway.exists');
      expect(await connection.sql`select id from gateways where id = ${issued.id}`).toHaveLength(1);
    });

    it('answers 409 for a gateway that exists, in the same or another household', async () => {
      const issued = ca.issue();
      await register(admin, householdId, issued.certificate).expect(201);
      const same = await register(admin, householdId, issued.certificate).expect(409);
      expect(errorCode(same)).toBe('gateway.exists');
      const other = await register(admin, otherHouseholdId, issued.certificate).expect(409);
      expect(errorCode(other)).toBe('gateway.exists');
      expect(JSON.stringify(other.body)).not.toContain(householdId);
      const [row] = await connection.sql<{ household_id: string }[]>`
        select household_id from gateways where id = ${issued.id}`;
      expect(row?.household_id).toBe(householdId);
    });

    it('answers 503 without a readable CA file and stores nothing', async () => {
      const issued = ca.issue();
      const before = await gatewayCount();
      const configured = env().GATEWAY_CA_FILE;
      try {
        env().GATEWAY_CA_FILE = undefined;
        const unset = await register(admin, householdId, issued.certificate).expect(503);
        expect(errorCode(unset)).toBe('gateway.caMissing');
        env().GATEWAY_CA_FILE = join(dir, 'does-not-exist.crt');
        const missing = await register(admin, householdId, issued.certificate).expect(503);
        expect(errorCode(missing)).toBe('gateway.caMissing');
        writeFileSync(join(dir, 'garbage.crt'), 'not a certificate');
        env().GATEWAY_CA_FILE = join(dir, 'garbage.crt');
        const garbage = await register(admin, householdId, issued.certificate).expect(503);
        expect(errorCode(garbage)).toBe('gateway.caMissing');
      } finally {
        env().GATEWAY_CA_FILE = configured;
      }
      expect(await gatewayCount()).toBe(before);
    });

    it('answers 403 to an owner who is no platform admin and to a member', async () => {
      const issued = ca.issue();
      const before = await gatewayCount();
      const owner = await register(ownerWithoutAdmin, householdId, issued.certificate).expect(403);
      expect(errorCode(owner)).toBe('auth.forbidden');
      const plain = await register(member, householdId, issued.certificate).expect(403);
      expect(errorCode(plain)).toBe('household.forbidden');
      expect(await gatewayCount()).toBe(before);
    });

    it('answers 400 to a body without name or certificate', async () => {
      await request(app.getHttpServer())
        .post(`${HOUSEHOLDS}/${householdId}/gateways`)
        .set('Cookie', admin.cookie)
        .set('Origin', origin)
        .send({ name: 'Pi' })
        .expect(400);
    });

    it('answers 404 to an admin who is no member of the household', async () => {
      const stranger = await signedIn(true);
      const response = await register(stranger, householdId, ca.issue().certificate).expect(404);
      expect(errorCode(response)).toBe('household.notFound');
    });
  });

  describe('listing', () => {
    let listed: string;

    beforeAll(async () => {
      listed = await createHousehold(admin);
      await addMember(listed, ownerWithoutAdmin, 'owner');
      await addMember(listed, member, 'member');
    });

    it('lets an owner list the gateways of the household, and nobody else', async () => {
      const first = ca.issue();
      const second = ca.issue();
      await register(admin, listed, first.certificate, 'First').expect(201);
      await register(admin, listed, second.certificate, 'Second').expect(201);
      await register(admin, otherHouseholdId, ca.issue().certificate, 'Elsewhere').expect(201);
      const response = await list(ownerWithoutAdmin, listed).expect(200);
      const gateways = (response.body as unknown[]).map((item) => gatewaySchema.parse(item));
      expect(gateways.map((gateway) => gateway.name)).toEqual(['First', 'Second']);
      const denied = await list(member, listed).expect(403);
      expect(errorCode(denied)).toBe('household.forbidden');
    });

    it('warns about certificates that expire soon or have expired', async () => {
      const household = await createHousehold(admin);
      const soon = ca.issue({ endsInDays: 10 });
      const later = ca.issue({ endsInDays: 100 });
      const expired = ca.issue();
      await register(admin, household, soon.certificate).expect(201);
      await register(admin, household, later.certificate).expect(201);
      await register(admin, household, expired.certificate).expect(201);
      await connection.sql`
        update gateways set cert_expires_at = now() - interval '1 day' where id = ${expired.id}`;
      const response = await list(admin, household).expect(200);
      const warnings = Object.fromEntries(
        (response.body as Gateway[]).map((gateway) => [gateway.id, gateway.warnings]),
      );
      expect(warnings).toEqual({
        [soon.id]: ['certExpiring'],
        [later.id]: [],
        [expired.id]: ['certExpired'],
      });
    });

    it('leaves out the certificate warning of a revoked gateway', async () => {
      const household = await createHousehold(admin);
      const issued = ca.issue({ endsInDays: 10 });
      await register(admin, household, issued.certificate).expect(201);
      await revoke(admin, household, issued.id).expect(204);
      const response = await list(admin, household).expect(200);
      expect((response.body as Gateway[]).map((gateway) => gateway.warnings)).toEqual([[]]);
    });

    it('warns about a CRL that is due within 30 days, and about nothing without the file', async () => {
      const household = await createHousehold(admin);
      const issued = ca.issue({ endsInDays: 100 });
      await register(admin, household, issued.certificate).expect(201);
      const crl = join(dir, 'crl-next-update');
      const warningsNow = async (): Promise<string[]> =>
        ((await list(admin, household).expect(200)).body as Gateway[])[0]?.warnings ?? [];
      expect(await warningsNow()).toEqual([]);
      writeFileSync(crl, `${new Date(Date.now() + 10 * DAY_MS).toISOString()}\n`);
      expect(await warningsNow()).toEqual(['crlExpiring']);
      writeFileSync(crl, `${new Date(Date.now() + 200 * DAY_MS).toISOString()}\n`);
      expect(await warningsNow()).toEqual([]);
      writeFileSync(crl, 'garbage');
      expect(await warningsNow()).toEqual([]);
      rmSync(crl);
    });
  });

  describe('revocation', () => {
    it('sets revoked_at, keeps it on a second call and shows it in the list', async () => {
      const issued = ca.issue();
      await register(admin, householdId, issued.certificate).expect(201);
      const revokedAt = async (): Promise<string | null | undefined> => {
        const [row] = await connection.sql<{ revoked_at: string | null }[]>`
          select revoked_at::text from gateways where id = ${issued.id}`;
        return row?.revoked_at;
      };
      expect(await revokedAt()).toBeNull();
      await revoke(admin, householdId, issued.id).expect(204);
      const first = await revokedAt();
      expect(first).toEqual(expect.any(String));
      await revoke(admin, householdId, issued.id).expect(204);
      expect(await revokedAt()).toBe(first);
      const listed = (await list(admin, householdId).expect(200)).body as Gateway[];
      expect(listed.find((gateway) => gateway.id === issued.id)?.revokedAt).toBe(
        new Date(first ?? '').toISOString(),
      );
    });

    it('keeps the ID taken: a revoked gateway cannot be registered again', async () => {
      const issued = ca.issue();
      await register(admin, householdId, issued.certificate).expect(201);
      await revoke(admin, householdId, issued.id).expect(204);
      for (const household of [householdId, otherHouseholdId]) {
        const again = await register(admin, household, issued.certificate).expect(409);
        expect(errorCode(again)).toBe('gateway.exists');
      }
    });

    it('needs an owner who is a platform admin', async () => {
      const issued = ca.issue();
      await register(admin, householdId, issued.certificate).expect(201);
      expect(errorCode(await revoke(ownerWithoutAdmin, householdId, issued.id).expect(403))).toBe(
        'auth.forbidden',
      );
      expect(errorCode(await revoke(member, householdId, issued.id).expect(403))).toBe(
        'household.forbidden',
      );
      const [row] = await connection.sql<{ revoked_at: string | null }[]>`
        select revoked_at from gateways where id = ${issued.id}`;
      expect(row?.revoked_at).toBeNull();
    });

    it('answers 404 for unknown ids and for a gateway of another household', async () => {
      const issued = ca.issue();
      await register(admin, otherHouseholdId, issued.certificate).expect(201);
      for (const id of ['gw-00000000', 'nonsense', issued.id]) {
        expect(errorCode(await revoke(admin, householdId, id).expect(404))).toBe(
          'household.notFound',
        );
      }
      const [row] = await connection.sql<{ revoked_at: string | null }[]>`
        select revoked_at from gateways where id = ${issued.id}`;
      expect(row?.revoked_at).toBeNull();
      expect(errorCode(await revoke(admin, UNKNOWN_ID, issued.id).expect(404))).toBe(
        'household.notFound',
      );
    });
  });
});
