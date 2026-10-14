import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { connect, type MqttClient } from 'mqtt';
import postgres from 'postgres';
import { inject, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import {
  DEVICE_MESSAGE_HANDLER,
  DevicesRepository,
  HardwareRepository,
  type DeviceMessageHandler,
} from '../src/core/devices/index.js';
import { DeviceIngestConsumer } from '../src/core/devices/device-ingest.consumer.js';
import { runMigrations } from '../src/platform/database/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';
import { createTestCa, randomGatewayId, type TestCa } from './helpers/test-pki.js';

const fixture = readFileSync(
  new URL('../../gateway-simulator/fixtures/devices.json', import.meta.url),
  'utf8',
);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The ingest under load and at shutdown, against the real broker and database: what a replay
 * after a gateway outage looks like (thousands of QoS 1 messages at once) and a restart while
 * messages are being handled.
 */
describe('device ingest under load', () => {
  const testEnv = inject('testEnv');
  const originalEnv = { ...process.env };
  let ca: TestCa;
  let publisher: MqttClient;
  let sql: postgres.Sql;
  let url: string;
  let householdId: string;

  const publish = (topic: string, payload: unknown, retain = false): Promise<unknown> =>
    publisher.publishAsync(topic, typeof payload === 'string' ? payload : JSON.stringify(payload), {
      qos: 1,
      retain,
    });

  const startApp = async (): Promise<INestApplication> => {
    process.env.DATABASE_URL = url;
    process.env.GATEWAY_CA_FILE = ca.file;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    return app;
  };

  /** A gateway with the fixture's hardware and a device on the first plant. */
  const prepare = async (): Promise<{ gatewayId: string; deviceId: string; prefix: string }> => {
    const gatewayId = randomGatewayId();
    const prefix = `gw/${gatewayId}/z2m`;
    await sql`
      insert into gateways (id, household_id, name, topic_prefix, cert_fingerprint, cert_expires_at)
      values (${gatewayId}, ${householdId}, 'Pi', ${prefix}, 'fingerprint',
        now() + interval '300 days')`;
    await publish(`${prefix}/bridge/devices`, fixture, true);
    return { gatewayId, deviceId: '', prefix };
  };

  /** Binds a device to the hardware once the ingest has stored it. */
  const addDevice = async (app: INestApplication, gatewayId: string): Promise<string> => {
    const hardware = app.get(HardwareRepository, { strict: false });
    let hardwareId = '';
    await vi.waitFor(
      async () => {
        const found = await hardware.findByName(gatewayId, 'Pflanze 1');
        expect(found).toBeDefined();
        hardwareId = found?.id ?? '';
      },
      { timeout: 15_000, interval: 100 },
    );
    const created = await app
      .get(DevicesRepository, { strict: false })
      .createWithBinding(householdId, hardwareId, 'Pflanze 1');
    if (created.outcome !== 'created') throw new Error('no device');
    return created.device.id;
  };

  const countReadings = async (deviceId: string): Promise<number> => {
    const [row] = await sql<{ count: string }[]>`
      select count(*) from measurements where device_id = ${deviceId}`;
    return Number(row?.count);
  };

  beforeAll(async () => {
    ca = createTestCa();
    url = await createFreshDatabase(testEnv.DATABASE_URL);
    await runMigrations(url);
    sql = postgres(url, { max: 2, onnotice: () => undefined });
    const [household] = await sql<{ id: string }[]>`
      insert into households (name, timezone) values ('Home', 'Europe/Berlin') returning id`;
    householdId = household?.id ?? '';
    publisher = connect(testEnv.MQTT_URL, {
      username: testEnv.MQTT_USERNAME,
      password: testEnv.MQTT_PASSWORD,
      clientId: `test-load-${randomGatewayId()}`,
    });
    await vi.waitFor(() => expect(publisher.connected).toBe(true), { timeout: 10_000 });
  });

  afterAll(async () => {
    await publisher?.endAsync(true);
    await sql?.end();
    for (const name of ['DATABASE_URL', 'GATEWAY_CA_FILE']) {
      const original = originalEnv[name];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
    ca?.dispose();
  });

  it('processes a burst of QoS 1 messages with a slow handler without losing any', async () => {
    const total = 5000;
    const { gatewayId, prefix } = await prepare();
    const app = await startApp();
    try {
      const handler = app.get<DeviceMessageHandler>(DEVICE_MESSAGE_HANDLER);
      const original = handler.handle.bind(handler);
      let handled = 0;
      // A database that is slower than the broker: 1 ms more per message.
      vi.spyOn(handler, 'handle').mockImplementation(async (...args) => {
        await sleep(1);
        await original(...args);
        handled += 1;
      });
      const deviceId = await addDevice(app, gatewayId);

      const base = Date.now() - total * 1000;
      for (let start = 0; start < total; start += 500) {
        await Promise.all(
          Array.from({ length: 500 }, (_, offset) => {
            const index = start + offset;
            return publish(`${prefix}/Pflanze 1`, {
              soil_moisture: index % 100,
              last_seen: new Date(base + index * 1000).toISOString(),
            });
          }),
        );
      }

      await vi.waitFor(() => expect(handled).toBe(total), { timeout: 100_000, interval: 200 });
      const consumer = app.get(DeviceIngestConsumer);
      expect(consumer.discarded).toEqual({ unknownName: 0, invalid: 0, overflow: 0 });
      await vi.waitFor(async () => expect(await countReadings(deviceId)).toBe(total), {
        timeout: 15_000,
        interval: 200,
      });
    } finally {
      await app.close();
    }
  }, 150_000);

  it('handles the messages it has taken before the app shuts down', async () => {
    const { gatewayId, prefix } = await prepare();
    const app = await startApp();
    const handler = app.get<DeviceMessageHandler>(DEVICE_MESSAGE_HANDLER);
    const original = handler.handle.bind(handler);
    let started = 0;
    let finished = 0;
    vi.spyOn(handler, 'handle').mockImplementation(async (...args) => {
      started += 1;
      await sleep(100);
      await original(...args);
      finished += 1;
    });
    const deviceId = await addDevice(app, gatewayId);
    const base = Date.now() - 100_000;
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        publish(`${prefix}/Pflanze 1`, {
          soil_moisture: index,
          last_seen: new Date(base + index * 1000).toISOString(),
        }),
      ),
    );
    await vi.waitFor(() => expect(started).toBeGreaterThanOrEqual(3), { interval: 10 });

    await app.close();

    // Nothing is left half done, and all that was done is stored.
    expect(finished).toBe(started);
    expect(started).toBeLessThan(50);
    expect(await countReadings(deviceId)).toBe(finished);
  });
});
