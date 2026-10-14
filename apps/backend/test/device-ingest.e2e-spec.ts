import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { connect, type MqttClient } from 'mqtt';
import postgres from 'postgres';
import type { StartedTestContainer } from 'testcontainers';
import { inject, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DeviceIngestConsumer } from '../src/core/devices/device-ingest.consumer.js';
import { GatewaysService } from '../src/core/gateways/gateways.service.js';
import { CLOCK } from '../src/core/identity/index.js';
import { runMigrations } from '../src/platform/database/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';
import { startTestBroker } from './helpers/test-broker.js';
import { createTestCa, randomGatewayId, type TestCa } from './helpers/test-pki.js';

interface HardwareRecord {
  id: string;
  friendly_name: string;
  vendor: string;
  model: string;
  availability: string;
  last_state: Record<string, unknown>;
  last_seen_at: Date | null;
  removed_at: Date | null;
}
interface CapabilityRecord {
  key: string;
  kind: string;
  readable: boolean;
  writable: boolean;
  is_setting: boolean;
}

const fixture = readFileSync(
  new URL('../../gateway-simulator/fixtures/devices.json', import.meta.url),
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

/** Polls instead of sleeping: the consumer works asynchronously behind the broker. */
const eventually = async (check: () => unknown, timeout = 15_000): Promise<void> => {
  await vi.waitFor(check, { timeout, interval: 100 });
};

describe('device ingest from the broker', () => {
  const testEnv = inject('testEnv');
  const originalEnv = { ...process.env };
  let ca: TestCa;
  let broker: StartedTestContainer;
  let publisher: MqttClient;
  let sql: postgres.Sql;
  let app: INestApplication;
  let consumer: DeviceIngestConsumer;
  let householdId: string;
  let now = new Date();
  const log = vi.spyOn(Logger.prototype, 'log');

  const prefixOf = (id: string): string => `gw/${id}/z2m`;
  const publish = async (topic: string, payload: unknown, retain = false): Promise<void> => {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    await publisher.publishAsync(topic, body, { qos: 1, retain });
  };
  const insertGateway = async (id: string, revoked = false): Promise<void> => {
    await sql`
      insert into gateways (id, household_id, name, topic_prefix, cert_fingerprint, cert_expires_at,
        revoked_at)
      values (${id}, ${householdId}, 'Pi', ${prefixOf(id)}, 'fingerprint',
        now() + interval '300 days', ${revoked ? now : null})`;
  };
  const hardwareOf = (gatewayId: string): Promise<HardwareRecord[]> =>
    sql<HardwareRecord[]>`
      select id, friendly_name, vendor, model, availability, last_state, last_seen_at, removed_at
      from hardware where gateway_id = ${gatewayId} order by friendly_name`;
  const named = async (gatewayId: string, name: string): Promise<HardwareRecord> => {
    const row = (await hardwareOf(gatewayId)).find((entry) => entry.friendly_name === name);
    if (!row) throw new Error(`no hardware ${name} of ${gatewayId}`);
    return row;
  };
  const capabilitiesOf = (hardwareId: string): Promise<CapabilityRecord[]> =>
    sql<CapabilityRecord[]>`
      select key, kind, readable, writable, is_setting from capabilities
      where hardware_id = ${hardwareId}`;
  /** A message after the ones under test: once it arrives, everything before it was handled. */
  const sentinel = async (gatewayId: string, name: string): Promise<void> => {
    const marker = Math.random();
    await publish(`${prefixOf(gatewayId)}/${name}`, { marker });
    await eventually(async () => {
      expect((await named(gatewayId, name)).last_state.marker).toBe(marker);
    });
  };
  const publishFixture = (gatewayId: string): Promise<void> =>
    publish(`${prefixOf(gatewayId)}/bridge/devices`, fixture, true);

  const retainedGateway = randomGatewayId();

  beforeAll(async () => {
    ca = createTestCa();
    const port = await freePort();
    broker = await startTestBroker(port);
    const url = await createFreshDatabase(testEnv.DATABASE_URL);
    await runMigrations(url);
    sql = postgres(url, { max: 2, onnotice: () => undefined });
    const [household] = await sql<{ id: string }[]>`
      insert into households (name, timezone) values ('Home', 'Europe/Berlin') returning id`;
    householdId = household?.id ?? '';
    publisher = connect(`mqtt://127.0.0.1:${port}`, {
      username: testEnv.MQTT_USERNAME,
      password: testEnv.MQTT_PASSWORD,
      clientId: `test-publisher-${randomGatewayId()}`,
    });
    await vi.waitFor(() => expect(publisher.connected).toBe(true), { timeout: 10_000 });
    // Retained before the consumer exists: it must pick this up when it starts.
    await insertGateway(retainedGateway);
    await publishFixture(retainedGateway);

    process.env.DATABASE_URL = url;
    process.env.MQTT_URL = `mqtt://127.0.0.1:${port}`;
    process.env.GATEWAY_CA_FILE = ca.file;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(() => now)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    consumer = app.get(DeviceIngestConsumer);
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

  it('discovers the simulator fixture from a retained bridge/devices', async () => {
    await eventually(async () => expect(await hardwareOf(retainedGateway)).toHaveLength(7));
    const plants = (await hardwareOf(retainedGateway)).filter((row) =>
      row.friendly_name.startsWith('Pflanze'),
    );
    expect(plants).toHaveLength(6);
    expect(plants[0]).toMatchObject({ vendor: 'AOYAN', model: 'AY-303Z', removed_at: null });

    const sensor = await capabilitiesOf(plants[0]?.id ?? '');
    const flag = (key: string) => sensor.find((capability) => capability.key === key);
    for (const key of ['soil_moisture', 'battery', 'dry']) {
      expect(flag(key)).toMatchObject({ readable: true, is_setting: false });
    }
    for (const key of ['temperature_calibration', 'temperature_sampling', 'soil_warning']) {
      expect(flag(key)).toMatchObject({ readable: true, writable: true, is_setting: true });
    }

    const lamp = await capabilitiesOf((await named(retainedGateway, 'Lampe')).id);
    const lampFlag = (key: string) => lamp.find((capability) => capability.key === key);
    expect(lampFlag('state')).toMatchObject({ kind: 'binary', is_setting: false });
    expect(lampFlag('brightness')).toMatchObject({ is_setting: false });
    expect(lampFlag('power_on_behavior')).toMatchObject({ is_setting: true });
    expect(lampFlag('effect')).toMatchObject({ readable: false, writable: true });
  });

  it('stores a device message and the availability under the name', async () => {
    now = new Date(Date.now() + 1000);
    await publish(`${prefixOf(retainedGateway)}/Pflanze 1/availability`, { state: 'offline' });
    await publish(`${prefixOf(retainedGateway)}/Pflanze 1`, { soil_moisture: 33, battery: 71 });
    await eventually(async () => {
      expect(await named(retainedGateway, 'Pflanze 1')).toMatchObject({
        availability: 'offline',
        last_state: { soil_moisture: 33, battery: 71 },
        last_seen_at: now,
      });
    });
  });

  it('follows a rename: the new name lands correctly, the old one is discarded and counted', async () => {
    const before = consumer.discarded.unknownName;
    await publish(`${prefixOf(retainedGateway)}/bridge/event`, {
      type: 'device_renamed',
      data: { from: 'Lampe', to: 'Stehlampe', homeassistant_rename: false },
    });
    await eventually(async () => {
      expect((await named(retainedGateway, 'Stehlampe')).vendor).toBe('IKEA');
    });
    await publish(`${prefixOf(retainedGateway)}/Stehlampe`, { state: 'ON' });
    await publish(`${prefixOf(retainedGateway)}/Lampe`, {
      state: 'OFF',
      secret: 'old-name-payload',
    });
    await publish(`${prefixOf(retainedGateway)}/Lampe`, {
      state: 'OFF',
      secret: 'old-name-payload',
    });
    await sentinel(retainedGateway, 'Pflanze 2');
    expect((await named(retainedGateway, 'Stehlampe')).last_state).toEqual({ state: 'ON' });
    expect(consumer.discarded.unknownName).toBe(before + 2);
    const mentions = log.mock.calls.filter((call) => String(call[0]).includes('"Lampe"'));
    expect(mentions).toHaveLength(1);
    expect(String(mentions[0]?.[0])).not.toContain('old-name-payload');
  });

  it('ignores command topics', async () => {
    const before = consumer.discarded.unknownName;
    await publish(`${prefixOf(retainedGateway)}/Stehlampe/set`, { state: 'OFF' });
    await publish(`${prefixOf(retainedGateway)}/Stehlampe/get`, { state: '' });
    await sentinel(retainedGateway, 'Pflanze 3');
    expect((await named(retainedGateway, 'Stehlampe')).last_state).toEqual({ state: 'ON' });
    expect(consumer.discarded.unknownName).toBe(before);
  });

  it('marks hardware that the bridge no longer lists as removed, and revives it', async () => {
    const withoutLamp = (JSON.parse(fixture) as { friendly_name: string }[]).filter(
      (device) => device.friendly_name !== 'Pflanze 6',
    );
    await publish(`${prefixOf(retainedGateway)}/bridge/devices`, withoutLamp, true);
    await eventually(async () => {
      expect((await named(retainedGateway, 'Pflanze 6')).removed_at).not.toBeNull();
    });
    await publishFixture(retainedGateway);
    await eventually(async () => {
      expect((await named(retainedGateway, 'Pflanze 6')).removed_at).toBeNull();
    });
  });

  it('gives two gateways with the same friendly_name their own hardware', async () => {
    // Registered while the consumer runs: it learns of the gateway through the registration.
    const issued = ca.issue();
    await app
      .get(GatewaysService)
      .register(householdId, { name: 'Second', certificate: issued.certificate });
    await publishFixture(issued.id);
    await eventually(async () => expect(await hardwareOf(issued.id)).toHaveLength(7));

    await publish(`${prefixOf(issued.id)}/Pflanze 1`, { soil_moisture: 5 });
    await sentinel(issued.id, 'Pflanze 2');
    expect((await named(issued.id, 'Pflanze 1')).last_state).toEqual({ soil_moisture: 5 });
    expect((await named(retainedGateway, 'Pflanze 1')).last_state).toEqual({
      soil_moisture: 33,
      battery: 71,
    });
    expect((await named(issued.id, 'Pflanze 1')).id).not.toBe(
      (await named(retainedGateway, 'Pflanze 1')).id,
    );
  });

  it('processes a gateway that is registered without a restart', async () => {
    const issued = ca.issue();
    // Its retained device list is already there when the gateway is registered.
    await publishFixture(issued.id);
    await publish(`${prefixOf(issued.id)}/Pflanze 4/availability`, { state: 'online' }, true);
    await app
      .get(GatewaysService)
      .register(householdId, { name: 'Late', certificate: issued.certificate });
    await eventually(async () => expect(await hardwareOf(issued.id)).toHaveLength(7));
    await eventually(async () => {
      expect((await named(issued.id, 'Pflanze 4')).availability).toBe('online');
    });
  });

  it('does not process a gateway that is revoked, neither at start nor while running', async () => {
    const revokedAtStart = randomGatewayId();
    await insertGateway(revokedAtStart, true);
    await publishFixture(revokedAtStart);

    const issued = ca.issue();
    await app
      .get(GatewaysService)
      .register(householdId, { name: 'Soon revoked', certificate: issued.certificate });
    await publishFixture(issued.id);
    await eventually(async () => expect(await hardwareOf(issued.id)).toHaveLength(7));
    await app.get(GatewaysService).revoke(householdId, issued.id);
    await publish(`${prefixOf(issued.id)}/Pflanze 1`, { soil_moisture: 99 });
    await publish(`${prefixOf(issued.id)}/Pflanze 1/availability`, { state: 'online' });
    await sentinel(retainedGateway, 'Pflanze 4');

    expect(await hardwareOf(revokedAtStart)).toEqual([]);
    expect(await named(issued.id, 'Pflanze 1')).toMatchObject({
      last_state: {},
      availability: 'unknown',
    });
  });
});
