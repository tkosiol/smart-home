import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { meSchema } from '@smart/contracts';
import { connect, type MqttClient } from 'mqtt';
import postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { StartedTestContainer } from 'testcontainers';
import { inject, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DevicesRepository, GatewayIngest, HardwareRepository } from '../src/core/devices/index.js';
import { GATEWAY_REGISTERED, GatewayEvents } from '../src/core/gateways/index.js';
import { SESSION_COOKIE, SessionService, UsersRepository } from '../src/core/identity/index.js';
import { MeasurementWriter } from '../src/core/telemetry/index.js';
import { runMigrations } from '../src/platform/database/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';
import { startTestBroker } from './helpers/test-broker.js';
import { createTestCa, type TestCa } from './helpers/test-pki.js';

const LAMP = '0a1b2c3d4e5f60718293a4b5c6d7e8f9';
const PLANT = '1b2c3d4e5f60718293a4b5c6d7e8f90a';
const DOOR = '2c3d4e5f60718293a4b5c6d7e8f90a1b';

/** The protocol examples both sides of the integration are tested against. */
const fixture = (name: string): string =>
  readFileSync(
    new URL(`../../../integrations/home-assistant/fixtures/${name}.json`, import.meta.url),
    'utf8',
  );
const withoutDoor = (): string => {
  const list = JSON.parse(fixture('devices')) as { devices: { id: string }[] };
  return JSON.stringify({ ...list, devices: list.devices.filter(({ id }) => id !== DOOR) });
};

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

interface GatewayRow {
  kind: string;
  bridge_status: string;
  service_status: string;
}

describe('a Home Assistant gateway through the real ingest', () => {
  const testEnv = inject('testEnv');
  const origin = testEnv.APP_ORIGIN;
  const originalEnv = { ...process.env };
  let ca: TestCa;
  let broker: StartedTestContainer;
  let publisher: MqttClient;
  let sql: postgres.Sql;
  let app: INestApplication<App>;
  let cookie: string;
  let householdId: string;
  let gatewayId: string;
  let lampHardwareId: string;
  let lampDeviceId: string;

  const publish = async (topic: string, payload: string, retain = false): Promise<void> => {
    await publisher.publishAsync(topic, payload, { qos: 1, retain });
  };
  const gatewayRow = async (id: string): Promise<GatewayRow> => {
    const [row] = await sql<GatewayRow[]>`
      select kind, bridge_status, service_status from gateways where id = ${id}`;
    if (!row) throw new Error(`no gateway ${id}`);
    return row;
  };
  const hardwareRows = async (): Promise<
    { id: string; address: string; name: string; removed: boolean }[]
  > =>
    sql`select id, address, name, removed_at is not null as removed from hardware
      where gateway_id = ${gatewayId} order by name`;
  const stateOf = async (): Promise<{ state: Record<string, unknown>; availability: string }> => {
    const [row] = await sql<{ state: Record<string, unknown>; availability: string }[]>`
      select state, availability from device_state where device_id = ${lampDeviceId}`;
    if (!row) throw new Error('no state');
    return row;
  };
  const readings = async (): Promise<{ capability: string; value: number; time: string }[]> => {
    await app.get(MeasurementWriter).flush();
    return sql`
      select capability, value_num::float as value, to_char(time at time zone 'UTC',
        'HH24:MI:SS.MS"Z"') as time
      from measurements where device_id = ${lampDeviceId} order by time, capability`;
  };
  /** The message of the same gateway published after it was handled proves what came before. */
  const flush = async (): Promise<void> => {
    const marker = `marker-${Date.now()}`;
    await publish(`gw/${gatewayId}/ha/device/${PLANT}`, JSON.stringify({ v: 1, entities: {} }));
    await publish(`gw/${gatewayId}/ha/status`, marker);
    await app.get(GatewayIngest).idle();
    await new Promise((resolve) => setTimeout(resolve, 300));
  };

  beforeAll(async () => {
    ca = createTestCa();
    const port = await freePort();
    broker = await startTestBroker(port);
    const url = await createFreshDatabase(testEnv.DATABASE_URL);
    await runMigrations(url);
    sql = postgres(url, { max: 4, onnotice: () => undefined });
    publisher = connect(`mqtt://127.0.0.1:${port}`, {
      username: testEnv.MQTT_USERNAME,
      password: testEnv.MQTT_PASSWORD,
      clientId: `test-publisher-${Date.now()}`,
    });
    await vi.waitFor(() => expect(publisher.connected).toBe(true), { timeout: 10_000 });

    process.env.DATABASE_URL = url;
    process.env.MQTT_URL = `mqtt://127.0.0.1:${port}`;
    process.env.GATEWAY_CA_FILE = ca.file;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    const users = app.get(UsersRepository);
    const user = await users.create({ email: 'ha-ingest@example.org', displayName: 'Owner' });
    await users.setPlatformAdmin(user.id);
    const { token } = await app.get(SessionService).create(user.id, 'email_code', 'Browser/1');
    cookie = `${SESSION_COOKIE}=${token}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/households')
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ name: 'Home', timezone: 'Europe/Berlin' })
      .expect(201);
    householdId = meSchema.parse(created.body).currentHouseholdId ?? '';
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

  it('follows a gateway of the kind ha with credentials access once it is announced', async () => {
    // Pairing (a later step) is what creates such a gateway; here the row is written directly.
    gatewayId = 'gw-hatest01';
    await sql`
      insert into gateways (id, household_id, name, topic_prefix, kind, auth, credential_generation)
      values (${gatewayId}, ${householdId}, 'Home Assistant', ${`gw/${gatewayId}/ha`}, 'ha',
        'credentials', 1)`;
    app.get(GatewayEvents).emit(GATEWAY_REGISTERED, {
      gatewayId,
      kind: 'ha',
      topicPrefix: `gw/${gatewayId}/ha`,
    });
    await app.get(GatewayIngest).idle();

    await eventually(async () => {
      // The subscription may not be at the broker yet: repeat until it is.
      await publish(`gw/${gatewayId}/bridge/connection`, '1');
      await publish(`gw/${gatewayId}/ha/status`, 'online');
      expect(await gatewayRow(gatewayId)).toEqual({
        kind: 'ha',
        bridge_status: 'online',
        service_status: 'online',
      });
    });
  });

  it('lists the devices as new hardware with their capabilities', async () => {
    await publish(`gw/${gatewayId}/ha/devices`, fixture('devices'), true);
    await eventually(async () => expect(await hardwareRows()).toHaveLength(3));
    const hardware = app.get(HardwareRepository);
    expect((await hardwareRows()).map(({ name }) => name)).toEqual([
      'Flurtür',
      'Monstera',
      'Stehlampe',
    ]);
    const keysOf = async (address: string): Promise<string[]> => {
      const found = await hardware.findByAddress(gatewayId, address);
      return (found?.capabilities ?? []).map(({ key }) => key).sort();
    };
    expect(await keysOf(LAMP)).toEqual(['brightness', 'color_temp', 'state']);
    expect(await keysOf(PLANT)).toEqual([
      'battery',
      'soil_moisture',
      'temperature',
      'temperature_2',
    ]);
    expect(await keysOf(DOOR)).toEqual(['contact', 'state']);
    const unassigned = await hardware.listUnassigned(householdId);
    expect(unassigned.map(({ name }) => name).sort()).toEqual(['Flurtür', 'Monstera', 'Stehlampe']);
  });

  it('stores the readings of the lamp with the time of the snapshot and marks it online', async () => {
    const found = await app.get(HardwareRepository).findByAddress(gatewayId, LAMP);
    lampHardwareId = found?.id ?? '';
    const created = await app
      .get(DevicesRepository)
      .createWithBinding(householdId, lampHardwareId, 'Stehlampe');
    if (created.outcome !== 'created') throw new Error('no device');
    lampDeviceId = created.device.id;

    await publish(`gw/${gatewayId}/ha/device/${LAMP}`, fixture('device-lamp-on'));
    await eventually(async () => expect((await stateOf()).availability).toBe('online'));
    await eventually(async () => expect(await readings()).toHaveLength(3));

    expect(await readings()).toEqual([
      { capability: 'brightness', value: 50, time: '18:03:21.123Z' },
      { capability: 'color_temp', value: 2700, time: '18:03:21.123Z' },
      { capability: 'state', value: 1, time: '18:03:21.123Z' },
    ]);
    expect((await stateOf()).state).toMatchObject({
      state: true,
      brightness: 50,
      color_temp: 2700,
    });
  });

  it('keeps the newer state when an older, retained copy arrives later', async () => {
    await publish(`gw/${gatewayId}/ha/device/${LAMP}`, fixture('device-lamp-off'));
    await eventually(async () => expect((await stateOf()).state).toMatchObject({ state: false }));
    const before = await readings();

    await publish(`gw/${gatewayId}/ha/device/${LAMP}`, fixture('device-lamp-on'), true);
    await flush();

    expect((await stateOf()).state).toMatchObject({ state: false });
    expect(await readings()).toEqual(before);
  });

  it('marks the lamp offline without new readings when it becomes unavailable', async () => {
    // After the lamp went off at 18:05; the unavailable snapshot is from 18:06.
    const before = await readings();
    await publish(`gw/${gatewayId}/ha/device/${LAMP}`, fixture('device-lamp-unavailable'));
    await eventually(async () => expect((await stateOf()).availability).toBe('offline'));
    await flush();
    expect(await readings()).toEqual(before);
  });

  it('ignores an empty message and removes a device that is no longer listed', async () => {
    await publish(`gw/${gatewayId}/ha/device/${DOOR}`, '', true);
    await flush();
    expect((await hardwareRows()).filter(({ removed }) => removed)).toEqual([]);

    await publish(`gw/${gatewayId}/ha/devices`, withoutDoor(), true);
    await eventually(async () =>
      expect(
        (await hardwareRows()).filter(({ removed }) => removed).map(({ name }) => name),
      ).toEqual(['Flurtür']),
    );
    expect((await hardwareRows()).find(({ name }) => name === 'Stehlampe')?.removed).toBe(false);
    expect((await stateOf()).state).toMatchObject({ state: false });
  });

  it('shows the service as offline on the offline status', async () => {
    await publish(`gw/${gatewayId}/ha/status`, 'offline');
    await eventually(async () =>
      expect((await gatewayRow(gatewayId)).service_status).toBe('offline'),
    );
  });

  it('applies a status only to a gateway of the matching kind', async () => {
    const issued = ca.issue();
    await request(app.getHttpServer())
      .post(`/api/v1/households/${householdId}/gateways`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ name: 'Pi', certificate: issued.certificate })
      .expect(201);
    await app.get(GatewayIngest).idle();
    const z2mId = issued.id;

    // The Z2M gateway gets the HA status topic and an own sign of life that proves the order.
    await publish(`gw/${z2mId}/ha/status`, 'online');
    await eventually(async () => {
      await publish(`gw/${z2mId}/bridge/connection`, '1');
      expect((await gatewayRow(z2mId)).bridge_status).toBe('online');
    });
    expect(await gatewayRow(z2mId)).toEqual({
      kind: 'z2m',
      bridge_status: 'online',
      service_status: 'unknown',
    });

    // And the other way round: a Z2M status does nothing for the HA gateway.
    await publish(`gw/${gatewayId}/z2m/bridge/state`, 'online');
    await flush();
    expect((await gatewayRow(gatewayId)).service_status).toBe('offline');
  });
});
