import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  apiErrorSchema,
  GATEWAY_ID_PATTERN,
  gatewayPairingRedeemedSchema,
  gatewayPairingSchema,
  hardwareSchema,
  meSchema,
  PAIRING_CODE_PATTERN,
  type GatewayPairingRedeemed,
} from '@smart/contracts';
import { connect, type MqttClient } from 'mqtt';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { StartedTestContainer } from 'testcontainers';
import { inject, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { GatewayCredentials } from '../src/core/gateways/credentials/gateway-credentials.service.js';
import { PairingCleanupJob } from '../src/core/gateways/pairing/pairing-cleanup.job.js';
import { SESSION_COOKIE, SessionService, UsersRepository } from '../src/core/identity/index.js';
import {
  DATABASE,
  type DatabaseConnection,
  runMigrations,
} from '../src/platform/database/index.js';
import { MQTT_CONNECTION, type MqttConnection } from '../src/platform/mqtt/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';
import { startTestBroker } from './helpers/test-broker.js';

const SECRET = randomBytes(24).toString('hex');
const HOUSEHOLDS = '/api/v1/households';
const REDEEM = '/api/v1/gateway-pairing/redeem';
const DAY_MS = 86_400_000;

/** The protocol example both sides of the integration are tested against. */
const devicesFixture = readFileSync(
  new URL('../../../integrations/home-assistant/fixtures/devices.json', import.meta.url),
  'utf8',
);

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('no port'));
      });
    });
  });

interface TestUser {
  id: string;
  cookie: string;
}

/** Home Assistant's connection over the websocket listener. */
interface GatewayConnection {
  client: MqttClient;
  closed: () => boolean;
}

describe('pairing Home Assistant with a code', () => {
  const testEnv = inject('testEnv');
  const origin = testEnv.APP_ORIGIN;
  const originalEnv = { ...process.env };
  const clients: MqttClient[] = [];
  let broker: StartedTestContainer;
  let databaseUrl: string;
  let app: INestApplication<App>;
  let connection: DatabaseConnection;
  let owner: TestUser;
  let userCounter = 0;
  let ipCounter = 0;

  /** A fresh client address per call: the per-IP limits must not leak between tests. */
  const nextIp = (): string => `203.0.113.${String((ipCounter = (ipCounter % 250) + 1))}`;
  const wsUrl = (): string => `ws://${broker.getHost()}:${String(broker.getMappedPort(8080))}/`;
  const errorCode = (response: request.Response): string =>
    apiErrorSchema.parse(response.body).code;

  const signedIn = async (): Promise<TestUser> => {
    userCounter += 1;
    const users = app.get(UsersRepository);
    const user = await users.create({
      email: `pairing${String(userCounter)}@example.org`,
      displayName: `User ${String(userCounter)}`,
    });
    const { token } = await app.get(SessionService).create(user.id, 'email_code', 'Browser/1');
    return { id: user.id, cookie: `${SESSION_COOKIE}=${token}` };
  };
  const createHousehold = async (user: TestUser = owner): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post(HOUSEHOLDS)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .set('X-Forwarded-For', nextIp())
      .send({ name: 'Home', timezone: 'Europe/Berlin' })
      .expect(201);
    const id = meSchema.parse(response.body).currentHouseholdId;
    if (!id) throw new Error('no current household');
    return id;
  };
  const createCode = (household: string, body: object = {}, user: TestUser = owner) =>
    request(app.getHttpServer())
      .post(`${HOUSEHOLDS}/${household}/gateway-pairings`)
      .set('Cookie', user.cookie)
      .set('Origin', origin)
      .set('X-Forwarded-For', nextIp())
      .send(body);
  const newCode = async (household: string, gatewayId?: string): Promise<string> => {
    const response = await createCode(household, gatewayId ? { gatewayId } : {}).expect(201);
    return gatewayPairingSchema.parse(response.body).code;
  };
  /** As Home Assistant calls it: no cookie, no Origin. */
  const redeem = (body: object, ip = nextIp()) =>
    request(app.getHttpServer()).post(REDEEM).set('X-Forwarded-For', ip).send(body);
  const redeemed = async (body: object): Promise<GatewayPairingRedeemed> => {
    const response = await redeem(body).expect(200);
    return gatewayPairingRedeemedSchema.parse(response.body);
  };
  const gatewaysOf = async (household: string): Promise<{ id: string; generation: number }[]> =>
    connection.sql`
      select id, credential_generation as generation from gateways
      where household_id = ${household} order by created_at, id`;

  /** Resolves the connection, or the refusal's reason code; never reconnects on its own. */
  const connectGateway = ({
    username,
    password,
    clientId,
  }: GatewayPairingRedeemed): Promise<GatewayConnection | { refused: number | string }> =>
    new Promise((resolve, reject) => {
      let closed = false;
      const client = connect(wsUrl(), {
        username,
        password,
        clientId,
        reconnectPeriod: 0,
        connectTimeout: 5000,
      });
      clients.push(client);
      const timer = setTimeout(() => {
        reject(new Error('neither connected nor refused'));
      }, 8000);
      client.once('connect', () => {
        clearTimeout(timer);
        resolve({ client, closed: () => closed });
      });
      client.on('close', () => {
        closed = true;
      });
      client.once('error', (error) => {
        clearTimeout(timer);
        client.end(true);
        resolve({ refused: (error as { code?: number | string }).code ?? error.message });
      });
    });
  const connected = async (access: GatewayPairingRedeemed): Promise<GatewayConnection> => {
    const result = await connectGateway(access);
    if ('refused' in result) throw new Error(`refused: ${String(result.refused)}`);
    return result;
  };
  /** Refused for user name or password (MQTT 3.1.1: 4 bad credentials, 5 not authorised). */
  const expectRefused = async (access: GatewayPairingRedeemed): Promise<void> => {
    expect(await connectGateway(access)).toEqual({
      refused: expect.toBeOneOf([4, 5]) as unknown,
    });
  };

  beforeAll(async () => {
    const port = await freePort();
    broker = await startTestBroker(port);
    databaseUrl = await createFreshDatabase(testEnv.DATABASE_URL);
    await runMigrations(databaseUrl);

    process.env.DATABASE_URL = databaseUrl;
    process.env.MQTT_URL = `mqtt://127.0.0.1:${String(port)}`;
    process.env.GATEWAY_CREDENTIAL_SECRET = SECRET;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    configureApp(app);
    await app.init();
    // Listening once keeps supertest from opening a server per parallel request.
    await app.listen(0, '127.0.0.1');
    connection = app.get<DatabaseConnection>(DATABASE);
    expect(await app.get<MqttConnection>(MQTT_CONNECTION).waitUntilConnected(10_000)).toBe(true);
    // The role and the default ACL exist once the run the connect started is over.
    await app.get(GatewayCredentials).reconcile();
    owner = await signedIn();
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.endAsync(true)));
  });

  afterAll(async () => {
    await app?.close();
    await broker?.stop();
    for (const name of ['DATABASE_URL', 'MQTT_URL', 'GATEWAY_CREDENTIAL_SECRET']) {
      const original = originalEnv[name];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  });

  it('lets an owner create a code, but not a member who is not an owner', async () => {
    const household = await createHousehold();
    const response = await createCode(household).expect(201);
    const pairing = gatewayPairingSchema.parse(response.body);
    expect(pairing.code).toMatch(PAIRING_CODE_PATTERN);
    expect(pairing.appUrl).toBe(origin);
    expect(new Date(pairing.expiresAt).getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(pairing.expiresAt).toMatch(/Z$/);
    const [stored] = await connection.sql<{ code_hash: string }[]>`
      select code_hash from gateway_pairings where household_id = ${household}`;
    expect(stored?.code_hash).toMatch(/^[0-9a-f]{64}$/);

    const member = await signedIn();
    await connection.sql`
      insert into memberships (household_id, user_id, role)
      values (${household}, ${member.id}, 'member')`;
    const refused = await createCode(household, {}, member).expect(403);
    expect(errorCode(refused)).toBe('household.forbidden');
  });

  it('pairs without an Origin; the gateway connects and its devices show up as new hardware', async () => {
    const household = await createHousehold();
    const code = await newCode(household);
    const response = await redeem({ code, name: 'Ferienhaus' }).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const access = gatewayPairingRedeemedSchema.parse(response.body);
    const id = access.gatewayId;
    expect(id).toMatch(GATEWAY_ID_PATTERN);
    expect(access).toMatchObject({
      mqttUrl: `${origin.replace(/^http/, 'ws')}/mqtt`,
      username: id,
      clientId: `${id}-ha`,
    });
    expect(access.password).toHaveLength(43);
    const [row] = await connection.sql`
      select name, kind, auth, credential_generation, topic_prefix from gateways where id = ${id}`;
    expect(row).toEqual({
      name: 'Ferienhaus',
      kind: 'ha',
      auth: 'credentials',
      credential_generation: 1,
      topic_prefix: `gw/${id}/ha`,
    });

    const gateway = await connected(access);
    const names = async (): Promise<string[]> => {
      const listed = await request(app.getHttpServer())
        .get(`${HOUSEHOLDS}/${household}/hardware?state=unassigned`)
        .set('Cookie', owner.cookie)
        .expect(200);
      return (listed.body as unknown[])
        .map((entry) => hardwareSchema.parse(entry))
        .filter((hardware) => hardware.gatewayId === id)
        .map((hardware) => hardware.name)
        .sort();
    };
    await vi.waitFor(
      async () => {
        // The ingest may not follow the new gateway yet: publish until it does.
        await gateway.client.publishAsync(`gw/${id}/ha/devices`, devicesFixture, {
          qos: 1,
          retain: true,
        });
        expect(await names()).toEqual(['Flurtür', 'Monstera', 'Stehlampe']);
      },
      { timeout: 15_000, interval: 500 },
    );
  });

  it('redeems a code once when it arrives twice at the same time', async () => {
    const household = await createHousehold();
    const code = await newCode(household);
    const responses = await Promise.all([redeem({ code }), redeem({ code })]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 404]);
    const failed = responses.find((response) => response.status === 404);
    expect(failed && errorCode(failed)).toBe('gateway.pairingInvalid');
    expect(await gatewaysOf(household)).toHaveLength(1);
  });

  it('accepts a code in lower case with blanks', async () => {
    const household = await createHousehold();
    const code = await newCode(household);
    await redeem({ code: ` ${code.toLowerCase().replace('-', ' ')} ` }).expect(200);
    expect(await gatewaysOf(household)).toHaveLength(1);
  });

  it('pairs a gateway anew: same ID, new key, the old one refused', async () => {
    const household = await createHousehold();
    const first = await redeemed({ code: await newCode(household) });
    const id = first.gatewayId;
    const before = await connected(first);

    const again = await redeemed({
      code: await newCode(household, id),
      expectedGatewayId: id,
    });
    expect(again.gatewayId).toBe(id);
    expect(again.password).not.toBe(first.password);
    expect(await gatewaysOf(household)).toEqual([{ id, generation: 2 }]);
    await vi.waitFor(() => expect(before.closed()).toBe(true), { timeout: 5000 });
    await expectRefused(first);
    await connected(again);
  });

  it('keeps a code for a new gateway when Home Assistant expects another one', async () => {
    const household = await createHousehold();
    const { gatewayId } = await redeemed({ code: await newCode(household) });
    const code = await newCode(household);

    const refused = await redeem({ code, expectedGatewayId: gatewayId }).expect(409);
    expect(errorCode(refused)).toBe('gateway.pairingOtherGateway');
    expect(await gatewaysOf(household)).toHaveLength(1);
    await redeem({ code }).expect(200);
    expect(await gatewaysOf(household)).toHaveLength(2);
  });

  it('disconnects a gateway its owner revokes, refuses it after and pairs it no more', async () => {
    const household = await createHousehold();
    const access = await redeemed({ code: await newCode(household) });
    const gateway = await connected(access);

    await request(app.getHttpServer())
      .post(`${HOUSEHOLDS}/${household}/gateways/${access.gatewayId}/revoke`)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .expect(204);

    await vi.waitFor(() => expect(gateway.closed()).toBe(true), { timeout: 5000 });
    await expectRefused(access);
    const refused = await createCode(household, { gatewayId: access.gatewayId }).expect(404);
    expect(errorCode(refused)).toBe('household.notFound');
  });

  it('refuses a sixth gateway of a household, when creating and when redeeming', async () => {
    const household = await createHousehold();
    for (let i = 0; i < 4; i++) await redeemed({ code: await newCode(household) });
    const late = await newCode(household);
    await connection.sql`
      insert into gateways (id, household_id, name, topic_prefix, kind, auth, credential_generation)
      values ('gw-limit005', ${household}, 'Home Assistant', 'gw/gw-limit005/ha', 'ha',
        'credentials', 1)`;

    expect(errorCode(await createCode(household).expect(409))).toBe('gateway.limitReached');
    expect(errorCode(await redeem({ code: late }).expect(409))).toBe('gateway.limitReached');
    expect(await gatewaysOf(household)).toHaveLength(5);

    // The code stayed valid: with room again, it pairs.
    await connection.sql`update gateways set revoked_at = now() where id = 'gw-limit005'`;
    await redeem({ code: late }).expect(200);
    expect(await gatewaysOf(household)).toHaveLength(6);
  });

  it('answers 503 without the secret and keeps the code valid', async () => {
    const household = await createHousehold();
    const code = await newCode(household);
    // A second instance on the same database and broker, without the secret.
    process.env.MQTT_CLIENT_ID = `test-api-nosecret-${randomBytes(4).toString('hex')}`;
    delete process.env.GATEWAY_CREDENTIAL_SECRET;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const withoutSecret = moduleRef.createNestApplication<INestApplication<App>>();
    process.env.MQTT_CLIENT_ID = originalEnv.MQTT_CLIENT_ID;
    process.env.GATEWAY_CREDENTIAL_SECRET = SECRET;
    configureApp(withoutSecret);
    await withoutSecret.init();
    try {
      const response = await request(withoutSecret.getHttpServer())
        .post(REDEEM)
        .set('X-Forwarded-For', nextIp())
        .send({ code })
        .expect(503);
      expect(errorCode(response)).toBe('gateway.pairingUnavailable');
    } finally {
      await withoutSecret.close();
    }
    expect(await gatewaysOf(household)).toEqual([]);
    await redeem({ code }).expect(200);
  });

  it('allows 10 redeems per address in 15 minutes and answers the 11th with 429', async () => {
    const ip = '198.51.100.20';
    for (let i = 0; i < 10; i++) await redeem({ code: 'AAAA-AAAA' }, ip).expect(404);
    const limited = await redeem({ code: 'AAAA-AAAA' }, ip).expect(429);
    expect(errorCode(limited)).toBe('auth.rateLimited');
    await redeem({ code: 'AAAA-AAAA' }, nextIp()).expect(404);
  });

  it('cleans up codes redeemed or expired over 7 days ago, and nothing else', async () => {
    const household = await createHousehold();
    const ago = (days: number): Date => new Date(Date.now() - days * DAY_MS);
    const rows: [string, Date, Date | null][] = [
      ['used long ago', ago(8), ago(8)],
      ['expired long ago', ago(8), null],
      ['used recently', ago(6), ago(6)],
      ['expired recently', ago(1), null],
      ['open', new Date(Date.now() + 60_000), null],
    ];
    for (const [hash, expiresAt, usedAt] of rows) {
      await connection.sql`
        insert into gateway_pairings (household_id, code_hash, expires_at, used_at)
        values (${household}, ${hash}, ${expiresAt.toISOString()}::timestamptz,
          ${usedAt?.toISOString() ?? null}::timestamptz)`;
    }
    expect(await app.get(PairingCleanupJob).run()).toBe(2);
    const left = await connection.sql<{ code_hash: string }[]>`
      select code_hash from gateway_pairings where household_id = ${household}
      order by code_hash`;
    expect(left.map((row) => row.code_hash)).toEqual(['expired recently', 'open', 'used recently']);
  });
});
