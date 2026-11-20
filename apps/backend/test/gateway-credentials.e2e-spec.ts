import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { connect, type MqttClient } from 'mqtt';
import postgres from 'postgres';
import type { StartedTestContainer } from 'testcontainers';
import { inject, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DynsecClient } from '../src/core/gateways/credentials/dynsec.js';
import { GatewayCredentials } from '../src/core/gateways/credentials/gateway-credentials.service.js';
import { deriveGatewayPassword } from '../src/core/gateways/credentials/password.js';
import { runMigrations } from '../src/platform/database/index.js';
import { MQTT_CONNECTION, type MqttConnection } from '../src/platform/mqtt/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';
import { startTestBroker } from './helpers/test-broker.js';
import { randomGatewayId } from './helpers/test-pki.js';

const SECRET = randomBytes(24).toString('hex');

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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A gateway's connection over the websocket listener, as Home Assistant makes it. */
interface GatewayConnection {
  client: MqttClient;
  /** Whether the broker has closed the connection since it was made. */
  closed: () => boolean;
}

describe('gateway credentials at the broker', () => {
  const testEnv = inject('testEnv');
  const originalEnv = { ...process.env };
  const clients: MqttClient[] = [];
  let broker: StartedTestContainer;
  let sql: postgres.Sql;
  let app: INestApplication;
  let credentials: GatewayCredentials;
  let householdId: string;

  const key = (id: string, generation = 1): string => deriveGatewayPassword(SECRET, id, generation);
  const wsUrl = (): string => `ws://${broker.getHost()}:${broker.getMappedPort(8080)}/`;

  const insertHousehold = async (): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      insert into households (name, timezone) values ('Home', 'Europe/Berlin') returning id`;
    if (!row) throw new Error('no household');
    return row.id;
  };
  const insertGateway = async (id: string, household = householdId): Promise<void> => {
    await sql`
      insert into gateways (id, household_id, name, topic_prefix, kind, auth, credential_generation)
      values (${id}, ${household}, 'Home Assistant', ${`gw/${id}/ha`}, 'ha', 'credentials', 1)`;
  };

  /**
   * Connects as the gateway; resolves the connection, or the refusal's reason code. Never
   * reconnects on its own, so a closed connection stays closed.
   */
  const connectGateway = (
    id: string,
    password: string,
    clientId = `${id}-ha`,
  ): Promise<GatewayConnection | { refused: number | string }> =>
    new Promise((resolve, reject) => {
      let closed = false;
      const client = connect(wsUrl(), {
        username: id,
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
  const connected = async (id: string, password: string): Promise<GatewayConnection> => {
    const result = await connectGateway(id, password);
    if ('refused' in result) throw new Error(`refused: ${String(result.refused)}`);
    return result;
  };
  /** Refused for user name or password (MQTT 3.1.1: 4 bad credentials, 5 not authorised). */
  const expectRefused = async (id: string, password: string): Promise<void> => {
    const result = await connectGateway(id, password);
    expect(result).toEqual({ refused: expect.toBeOneOf([4, 5]) as unknown });
  };
  const brokerUsers = async (): Promise<string[]> => {
    const control = new DynsecClient(app.get<MqttConnection>(MQTT_CONNECTION));
    try {
      const data = await control.send({ command: 'listClients' });
      return (data?.clients as string[] | undefined) ?? [];
    } finally {
      control.close();
    }
  };

  beforeAll(async () => {
    const port = await freePort();
    broker = await startTestBroker(port);
    const url = await createFreshDatabase(testEnv.DATABASE_URL);
    await runMigrations(url);
    sql = postgres(url, { max: 2, onnotice: () => undefined });
    householdId = await insertHousehold();

    process.env.DATABASE_URL = url;
    process.env.MQTT_URL = `mqtt://127.0.0.1:${port}`;
    process.env.GATEWAY_CREDENTIAL_SECRET = SECRET;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    credentials = app.get(GatewayCredentials);
    expect(await app.get<MqttConnection>(MQTT_CONNECTION).waitUntilConnected(10_000)).toBe(true);
    // The run the connect started is over once this one is: no run of its own from here on.
    await credentials.reconcile();
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.endAsync(true)));
  });

  afterAll(async () => {
    await app?.close();
    await sql?.end();
    await broker?.stop();
    for (const name of ['DATABASE_URL', 'MQTT_URL', 'GATEWAY_CREDENTIAL_SECRET']) {
      const original = originalEnv[name];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
  });

  it('lets a gateway in with its derived key after a reconcile, below its own prefix', async () => {
    const id = randomGatewayId();
    await insertGateway(id);
    await expectRefused(id, key(id));
    await credentials.reconcile();

    const received: string[] = [];
    const unsubscribe = app
      .get<MqttConnection>(MQTT_CONNECTION)
      .subscribe(`gw/${id}/ha/probe`, (_topic, payload) => {
        received.push(payload.toString());
      });
    try {
      const gateway = await connected(id, key(id));
      await vi.waitFor(
        async () => {
          await gateway.client.publishAsync(`gw/${id}/ha/probe`, 'hello', { qos: 1 });
          expect(received).toContain('hello');
        },
        { timeout: 10_000, interval: 200 },
      );
    } finally {
      unsubscribe();
    }
    // The client ID is bound to the user.
    expect(await connectGateway(id, key(id), `${id}-other`)).toEqual({
      refused: expect.toBeOneOf([4, 5]) as unknown,
    });
  });

  it('does not disconnect a gateway when nothing changed', async () => {
    const id = randomGatewayId();
    await insertGateway(id);
    await credentials.reconcile();
    const gateway = await connected(id, key(id));
    await credentials.reconcile();
    await sleep(2000);
    expect(gateway.closed()).toBe(false);
    expect(gateway.client.connected).toBe(true);
  });

  it('rekeys a gateway whose generation changed: disconnected, old key refused, new key works', async () => {
    const id = randomGatewayId();
    await insertGateway(id);
    await credentials.reconcile();
    const gateway = await connected(id, key(id));

    await sql`update gateways set credential_generation = 2 where id = ${id}`;
    await credentials.reconcile();

    await vi.waitFor(() => expect(gateway.closed()).toBe(true), { timeout: 5000 });
    await expectRefused(id, key(id, 1));
    await connected(id, key(id, 2));
  });

  it('removes the user of a revoked gateway', async () => {
    const id = randomGatewayId();
    await insertGateway(id);
    await credentials.reconcile();
    const gateway = await connected(id, key(id));

    await sql`update gateways set revoked_at = now() where id = ${id}`;
    await credentials.reconcile();

    await vi.waitFor(() => expect(gateway.closed()).toBe(true), { timeout: 5000 });
    await expectRefused(id, key(id));
    expect(await brokerUsers()).not.toContain(id);
  });

  it('removes the user when the household is deleted', async () => {
    const household = await insertHousehold();
    const id = randomGatewayId();
    await insertGateway(id, household);
    await credentials.reconcile();
    expect(await brokerUsers()).toContain(id);

    await sql`delete from households where id = ${household}`;
    await credentials.reconcile();

    expect(await brokerUsers()).not.toContain(id);
    await expectRefused(id, key(id));
  });

  it('recreates the users after a broker restart', async () => {
    const id = randomGatewayId();
    await insertGateway(id);
    await credentials.reconcile();
    await connected(id, key(id));

    await broker.restart({ timeout: 5000 });

    // The broker starts empty; the backend reconnects and reconciles on its own.
    await vi.waitFor(
      async () => {
        const gateway = await connected(id, key(id));
        await gateway.client.endAsync(true);
      },
      { timeout: 60_000, interval: 1000 },
    );
  }, 90_000);
});
