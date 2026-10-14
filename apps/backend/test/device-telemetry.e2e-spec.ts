import type { Capability } from '@smart/contracts';
import postgres from 'postgres';
import { inject } from 'vitest';
import {
  DeviceMessageProcessor,
  DevicesRepository,
  HardwareRepository,
  type Z2mDevice,
} from '../src/core/devices/index.js';
import { MeasurementsRepository, MeasurementWriter } from '../src/core/telemetry/index.js';
import {
  createDatabaseConnection,
  runMigrations,
  type DatabaseConnection,
} from '../src/platform/database/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';
import { randomGatewayId } from './helpers/test-pki.js';

const capability = (key: string, kind: Capability['kind'], enumValues?: string[]): Capability => ({
  key,
  kind,
  unit: null,
  min: null,
  max: null,
  step: null,
  enumValues: enumValues ?? null,
  readable: true,
  writable: false,
  isSetting: false,
});

const sensor = (ieee: string, name: string): Z2mDevice => ({
  ieeeAddress: ieee,
  friendlyName: name,
  vendor: 'Acme',
  model: 'AY-303Z',
  description: null,
  definition: { model: 'AY-303Z' },
  interviewState: 'SUCCESSFUL',
  capabilities: [
    capability('soil_moisture', 'numeric'),
    capability('occupancy', 'binary'),
    capability('mode', 'enum', ['eco', 'boost']),
  ],
});

interface StateRecord {
  state: Record<string, unknown>;
  last_seen_at: Date | null;
}
interface HardwareRecord {
  last_state: Record<string, unknown>;
  last_seen_at: Date | null;
}
interface MeasurementRecord {
  time: Date;
  capability: string;
  value_num: number | null;
  value_text: string | null;
  flags: string[];
}

/** The processing of device messages against the real database and the real writer. */
describe('readings of the device ingest', () => {
  const testEnv = inject('testEnv');
  const received = new Date('2026-10-14T12:00:00.000Z');
  const minutesAgo = (minutes: number): string =>
    new Date(received.getTime() - minutes * 60_000).toISOString();
  let connection: DatabaseConnection;
  let sql: postgres.Sql;
  let hardware: HardwareRepository;
  let devices: DevicesRepository;
  let writer: MeasurementWriter;
  let processor: DeviceMessageProcessor;
  let householdId: string;
  let gatewayId: string;
  let counter = 0;

  /** A piece of hardware, optionally with a device on it. */
  const setup = async (withDevice: boolean): Promise<{ hardwareId: string; deviceId?: string }> => {
    counter += 1;
    const name = `Sensor ${counter}`;
    await hardware.upsertFromBridge(
      gatewayId,
      [sensor(`0x${counter.toString(16).padStart(16, '0')}`, name)],
      received,
    );
    const found = await hardware.findByName(gatewayId, name);
    if (!found) throw new Error('no hardware');
    if (!withDevice) return { hardwareId: found.id };
    const created = await devices.createWithBinding(householdId, found.id, name);
    if (created.outcome !== 'created') throw new Error('no device');
    return { hardwareId: found.id, deviceId: created.device.id };
  };
  const send = (
    hardwareId: string,
    payload: Record<string, unknown>,
    retained = false,
    receivedAt = received,
  ) => processor.handle(gatewayId, hardwareId, payload, receivedAt, retained);
  const hardwareRow = async (id: string): Promise<HardwareRecord> => {
    const [row] = await sql<HardwareRecord[]>`
      select last_state, last_seen_at from hardware where id = ${id}`;
    if (!row) throw new Error('no hardware row');
    return { ...row, last_seen_at: row.last_seen_at && new Date(row.last_seen_at) };
  };
  const stateRow = async (deviceId: string): Promise<StateRecord> => {
    const [row] = await sql<StateRecord[]>`
      select state, last_seen_at from device_state where device_id = ${deviceId}`;
    if (!row) throw new Error('no state row');
    return { ...row, last_seen_at: row.last_seen_at && new Date(row.last_seen_at) };
  };
  const readings = async (deviceId: string): Promise<MeasurementRecord[]> => {
    await writer.flush();
    const rows = await sql<MeasurementRecord[]>`
      select time, capability, value_num, value_text, flags
      from measurements where device_id = ${deviceId} order by time, capability`;
    return rows.map((row) => ({ ...row, time: new Date(row.time) }));
  };

  beforeAll(async () => {
    const url = await createFreshDatabase(testEnv.DATABASE_URL);
    await runMigrations(url);
    connection = createDatabaseConnection(url);
    sql = connection.sql;
    hardware = new HardwareRepository(connection);
    devices = new DevicesRepository(connection);
    writer = new MeasurementWriter(new MeasurementsRepository(connection));
    processor = new DeviceMessageProcessor(hardware, devices, writer);
    const [household] = await sql<{ id: string }[]>`
      insert into households (name, timezone) values ('Home', 'Europe/Berlin') returning id`;
    householdId = household?.id ?? '';
    gatewayId = randomGatewayId();
    await sql`
      insert into gateways (id, household_id, name, topic_prefix, cert_fingerprint, cert_expires_at)
      values (${gatewayId}, ${householdId}, 'Pi', ${`gw/${gatewayId}/z2m`}, 'fingerprint',
        now() + interval '300 days')`;
  });

  afterAll(async () => {
    await writer.onModuleDestroy();
    await sql.end({ timeout: 5 });
  });

  it('without a device only keeps the valid part of the last state', async () => {
    const { hardwareId } = await setup(false);
    const seen = minutesAgo(1);

    await send(hardwareId, { soil_moisture: 30, linkquality: 80, last_seen: seen });

    expect(await hardwareRow(hardwareId)).toEqual({
      last_state: { soil_moisture: 30 },
      last_seen_at: new Date(seen),
    });
    await writer.flush();
    const [count] = await sql<{ count: string }[]>`select count(*)::text as count from measurements
      where capability = 'soil_moisture' and value_num = 30`;
    expect(count?.count).toBe('0');
  });

  it('with a device updates its state and stores readings (binary 0/1, enum text)', async () => {
    const { hardwareId, deviceId = '' } = await setup(true);
    const seen = minutesAgo(1);

    await send(hardwareId, {
      soil_moisture: 41.5,
      occupancy: true,
      mode: 'boost',
      last_seen: seen,
    });

    expect(await stateRow(deviceId)).toEqual({
      state: { soil_moisture: 41.5, occupancy: true, mode: 'boost' },
      last_seen_at: new Date(seen),
    });
    expect(await readings(deviceId)).toEqual([
      { time: new Date(seen), capability: 'mode', value_num: null, value_text: 'boost', flags: [] },
      { time: new Date(seen), capability: 'occupancy', value_num: 1, value_text: null, flags: [] },
      {
        time: new Date(seen),
        capability: 'soil_moisture',
        value_num: 41.5,
        value_text: null,
        flags: [],
      },
    ]);
  });

  it('stores the receive time and a flag when last_seen is not plausible', async () => {
    const { hardwareId, deviceId = '' } = await setup(true);

    await send(hardwareId, { soil_moisture: 22, last_seen: '1970-01-01T00:00:00Z' });

    expect(await readings(deviceId)).toEqual([
      {
        time: received,
        capability: 'soil_moisture',
        value_num: 22,
        value_text: null,
        flags: ['time_replaced'],
      },
    ]);
  });

  it('drops an invalid field and stores the rest', async () => {
    const { hardwareId, deviceId = '' } = await setup(true);
    const seen = minutesAgo(1);

    await send(hardwareId, {
      soil_moisture: 'wet',
      occupancy: false,
      mode: 'turbo',
      last_seen: seen,
    });

    expect((await stateRow(deviceId)).state).toEqual({ occupancy: false });
    expect((await readings(deviceId)).map((row) => row.capability)).toEqual(['occupancy']);
  });

  describe('late deliveries', () => {
    it('leave the newest state alone and every reading stored once, also when delivered twice', async () => {
      const { hardwareId, deviceId = '' } = await setup(true);
      // 299 old messages with rising times, one newer one in between.
      const messages = Array.from({ length: 300 }, (_, index) => ({
        soil_moisture: index,
        last_seen: minutesAgo(5000 - index),
      }));
      messages[100] = { soil_moisture: 1000, last_seen: minutesAgo(1) };

      for (const message of messages) await send(hardwareId, message);
      for (const message of messages) await send(hardwareId, message);

      expect(await stateRow(deviceId)).toEqual({
        state: { soil_moisture: 1000 },
        last_seen_at: new Date(minutesAgo(1)),
      });
      expect(await hardwareRow(hardwareId)).toEqual({
        last_state: { soil_moisture: 1000 },
        last_seen_at: new Date(minutesAgo(1)),
      });
      const stored = await readings(deviceId);
      expect(stored).toHaveLength(300);
      expect(new Set(stored.map((row) => row.time.getTime())).size).toBe(300);
    });
  });

  describe('a retained message', () => {
    it('is not a reading seen now: it changes nothing without a newer time of its own', async () => {
      const { hardwareId, deviceId = '' } = await setup(true);
      const seen = minutesAgo(10);
      await send(hardwareId, { soil_moisture: 30, last_seen: seen });

      await send(hardwareId, { soil_moisture: 99 }, true);
      await send(hardwareId, { soil_moisture: 98, last_seen: seen }, true);
      await send(hardwareId, { soil_moisture: 97, last_seen: minutesAgo(20) }, true);

      expect((await stateRow(deviceId)).state).toEqual({ soil_moisture: 30 });
      expect((await hardwareRow(hardwareId)).last_seen_at).toEqual(new Date(seen));
      expect((await readings(deviceId)).map((row) => row.value_num)).toEqual([30]);
    });

    it('with a newer last_seen of its own counts as a reading', async () => {
      const { hardwareId, deviceId = '' } = await setup(true);
      await send(hardwareId, { soil_moisture: 30, last_seen: minutesAgo(10) });
      const newer = minutesAgo(2);

      await send(hardwareId, { soil_moisture: 33, last_seen: newer }, true);

      expect((await hardwareRow(hardwareId)).last_seen_at).toEqual(new Date(newer));
      expect((await stateRow(deviceId)).state).toEqual({ soil_moisture: 33 });
      expect((await readings(deviceId)).map((row) => row.value_num)).toEqual([30, 33]);
    });

    it('is not mistaken for new data on a reconnect: the replay is ignored', async () => {
      const { hardwareId, deviceId = '' } = await setup(true);
      const message = { soil_moisture: 30, last_seen: minutesAgo(3) };
      await send(hardwareId, message);

      await send(hardwareId, message, true, new Date(received.getTime() + 3_600_000));

      expect((await readings(deviceId)).map((row) => row.value_num)).toEqual([30]);
      expect((await hardwareRow(hardwareId)).last_seen_at).toEqual(new Date(message.last_seen));
    });
  });
});
