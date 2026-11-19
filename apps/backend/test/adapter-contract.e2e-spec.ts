import { createServer } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { deviceSchema, hardwareSchema, meSchema, type Device } from '@smart/contracts';
import { connect, type MqttClient } from 'mqtt';
import postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { StartedTestContainer } from 'testcontainers';
import { inject, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { GATEWAY_ADAPTERS } from '../src/core/adapters/index.js';
import { GatewayIngest } from '../src/core/devices/index.js';
import { GatewaysService } from '../src/core/gateways/gateways.service.js';
import {
  CLOCK,
  SESSION_COOKIE,
  SessionService,
  UsersRepository,
} from '../src/core/identity/index.js';
import { runMigrations } from '../src/platform/database/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';
import { PlainAdapter } from './helpers/plain-adapter.js';
import { startTestBroker } from './helpers/test-broker.js';
import { createTestCa, type TestCa } from './helpers/test-pki.js';

const HOUSEHOLDS = '/api/v1/households';

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

/** Polls instead of sleeping: the consumers work asynchronously behind the broker. */
const eventually = async (check: () => unknown, timeout = 15_000): Promise<void> => {
  await vi.waitFor(check, { timeout, interval: 100 });
};

/**
 * The core with an adapter that speaks nothing like Zigbee2MQTT: the whole chain (status,
 * inventory, report, availability, activity) must work through the adapter contract alone.
 */
describe('the core with a non-z2m adapter', () => {
  const testEnv = inject('testEnv');
  const originalEnv = { ...process.env };
  let ca: TestCa;
  let broker: StartedTestContainer;
  let publisher: MqttClient;
  let sql: postgres.Sql;
  let app: INestApplication<App>;
  let cookie: string;
  let householdId: string;
  let gatewayId: string;
  let now = new Date();

  const publish = async (topic: string, payload: string): Promise<void> => {
    await publisher.publishAsync(topic, payload, { qos: 1 });
  };
  const get = (path: string) => request(app.getHttpServer()).get(path).set('Cookie', cookie);
  const prefix = (): string => `gw/${gatewayId}/z2m`;

  beforeAll(async () => {
    ca = createTestCa();
    const port = await freePort();
    broker = await startTestBroker(port);
    const url = await createFreshDatabase(testEnv.DATABASE_URL);
    await runMigrations(url);
    sql = postgres(url, { max: 2, onnotice: () => undefined });
    publisher = connect(`mqtt://127.0.0.1:${port}`, {
      username: testEnv.MQTT_USERNAME,
      password: testEnv.MQTT_PASSWORD,
      clientId: `test-publisher-${Math.random().toString(16).slice(2)}`,
    });
    await vi.waitFor(() => expect(publisher.connected).toBe(true), { timeout: 10_000 });

    process.env.DATABASE_URL = url;
    process.env.MQTT_URL = `mqtt://127.0.0.1:${port}`;
    process.env.GATEWAY_CA_FILE = ca.file;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(() => now)
      .overrideProvider(GATEWAY_ADAPTERS)
      .useValue([new PlainAdapter()])
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    configureApp(app);
    await app.init();

    const user = await app
      .get(UsersRepository)
      .create({ email: 'plain@example.org', displayName: 'Plain' });
    const { token } = await app.get(SessionService).create(user.id, 'email_code', 'Browser/1');
    cookie = `${SESSION_COOKIE}=${token}`;
    const created = await request(app.getHttpServer())
      .post(HOUSEHOLDS)
      .set('Cookie', cookie)
      .set('Origin', testEnv.APP_ORIGIN)
      .send({ name: 'Home', timezone: 'Europe/Berlin' })
      .expect(201);
    householdId = meSchema.parse(created.body).currentHouseholdId ?? '';

    const issued = ca.issue();
    gatewayId = issued.id;
    await app
      .get(GatewaysService)
      .register(householdId, { name: 'Plain Pi', certificate: issued.certificate });
    await app.get(GatewayIngest).idle();
  });

  afterAll(async () => {
    await app?.close();
    await publisher?.endAsync(true);
    await sql?.end();
    await broker?.stop();
    for (const name of ['DATABASE_URL', 'MQTT_URL', 'GATEWAY_CA_FILE']) {
      const original = originalEnv[name];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
    ca?.dispose();
  });

  let deviceId = '';

  it('takes the service status from the adapter topic and payload', async () => {
    // The subscription of a gateway registered just now may not be at the broker yet.
    await eventually(async () => {
      await publish(`${prefix()}/service`, 'up');
      const response = await get(`${HOUSEHOLDS}/${householdId}/gateways`).expect(200);
      expect(response.body).toMatchObject([{ id: gatewayId, serviceStatus: 'online' }]);
    });
  });

  it('lists the inventory of the adapter as unassigned hardware', async () => {
    const inventory = [
      {
        id: 'node-1',
        title: 'Tomatoes',
        caps: [{ key: 'soil_moisture', kind: 'numeric', unit: '%', read: true, write: false }],
      },
    ];
    await eventually(async () => {
      await publish(`${prefix()}/inventory`, JSON.stringify(inventory));
      const response = await get(`${HOUSEHOLDS}/${householdId}/hardware?state=unassigned`).expect(
        200,
      );
      const items = (response.body as unknown[]).map((item) => hardwareSchema.parse(item));
      expect(items).toMatchObject([{ externalId: 'node-1', name: 'Tomatoes' }]);
    });
  });

  it('creates a device from it, then stores reports, activity and availability', async () => {
    const hardware = await get(`${HOUSEHOLDS}/${householdId}/hardware?state=unassigned`).expect(
      200,
    );
    const hardwareId = (hardware.body as { id: string }[])[0]?.id;
    const created = await request(app.getHttpServer())
      .post(`${HOUSEHOLDS}/${householdId}/devices`)
      .set('Cookie', cookie)
      .set('Origin', testEnv.APP_ORIGIN)
      .send({ hardwareId, name: 'Tomatoes' })
      .expect(201);
    deviceId = deviceSchema.parse(created.body).id;

    now = new Date(Date.now() + 10_000);
    await eventually(async () => {
      await publish(`${prefix()}/node/node-1`, '{"soil_moisture":33}');
      const response = await get(`${HOUSEHOLDS}/${householdId}/devices/${deviceId}`).expect(200);
      const device: Device = deviceSchema.parse(response.body);
      expect(device.state).toEqual({ soil_moisture: 33 });
    });
    await eventually(async () => {
      const [stored] = await sql<{ count: number }[]>`
        select count(*)::int as count from measurements
        where device_id = ${deviceId} and capability = 'soil_moisture' and value_num = 33`;
      expect(stored?.count).toBeGreaterThan(0);
    });
    const [gateway] = await sql<{ last_message_at: Date | null }[]>`
      select last_message_at from gateways where id = ${gatewayId}`;
    expect(gateway?.last_message_at).not.toBeNull();

    await eventually(async () => {
      await publish(`${prefix()}/node/node-1/reach`, 'no');
      const response = await get(`${HOUSEHOLDS}/${householdId}/devices/${deviceId}`).expect(200);
      expect(deviceSchema.parse(response.body).availability).toBe('offline');
    });
  });

  it('ignores a message in the z2m format that the adapter does not classify', async () => {
    await publish(`${prefix()}/bridge/devices`, '[{"ieee_address":"0x1","friendly_name":"x"}]');
    // A message after it proves that the earlier one was handled.
    await publish(`${prefix()}/node/node-1`, '{"soil_moisture":44}');
    await eventually(async () => {
      const response = await get(`${HOUSEHOLDS}/${householdId}/devices/${deviceId}`).expect(200);
      expect(deviceSchema.parse(response.body).state).toEqual({ soil_moisture: 44 });
    });
    const [row] = await sql<{ count: number }[]>`
      select count(*)::int as count from hardware where gateway_id = ${gatewayId}`;
    expect(row?.count).toBe(1);
  });
});
