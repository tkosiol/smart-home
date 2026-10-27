import type { Capability } from '@smart/contracts';
import postgres from 'postgres';
import { inject } from 'vitest';
import {
  DevicesRepository,
  HardwareRepository,
  type Z2mDevice,
} from '../src/core/devices/index.js';
import { MeasurementsRepository } from '../src/core/telemetry/index.js';
import {
  createDatabaseConnection,
  runMigrations,
  type DatabaseConnection,
} from '../src/platform/database/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';
import { randomGatewayId } from './helpers/test-pki.js';

const numeric = (key: string, overrides: Partial<Capability> = {}): Capability => ({
  key,
  kind: 'numeric',
  unit: null,
  min: null,
  max: null,
  step: null,
  enumValues: null,
  readable: true,
  writable: false,
  isSetting: false,
  ...overrides,
});

const sensor = (ieee: string, name: string, extra: Partial<Z2mDevice> = {}): Z2mDevice => ({
  ieeeAddress: ieee,
  friendlyName: name,
  vendor: 'Acme',
  model: 'AY-303Z',
  description: 'Soil sensor',
  definition: { model: 'AY-303Z', exposes: [] },
  interviewState: 'SUCCESSFUL',
  capabilities: [
    numeric('soil_moisture', { unit: '%', min: 0, max: 100 }),
    numeric('soil_calibration', { readable: true, writable: true, isSetting: true }),
  ],
  ...extra,
});

describe('devices and telemetry data model', () => {
  const testEnv = inject('testEnv');
  const now = new Date('2026-10-14T10:00:00.000Z');
  let url: string;
  let connection: DatabaseConnection;
  let sql: postgres.Sql;
  let hardware: HardwareRepository;
  let devices: DevicesRepository;
  let measurements: MeasurementsRepository;

  const household = async (): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      insert into households (name, timezone) values ('Home', 'Europe/Berlin') returning id`;
    if (!row) throw new Error('no household');
    return row.id;
  };
  const gateway = async (householdId: string, revoked = false): Promise<string> => {
    const id = randomGatewayId();
    await sql`
      insert into gateways (id, household_id, name, topic_prefix, cert_fingerprint, cert_expires_at,
        revoked_at)
      values (${id}, ${householdId}, 'Pi', ${`gw/${id}/z2m`}, 'fingerprint',
        now() + interval '300 days', ${revoked ? now.toISOString() : null}::timestamptz)`;
    return id;
  };
  const hardwareId = async (gatewayId: string, name: string): Promise<string> => {
    const row = await hardware.findByName(gatewayId, name);
    if (!row) throw new Error(`no hardware ${name}`);
    return row.id;
  };
  const count = async (table: string): Promise<number> => {
    const [row] = await sql.unsafe<{ n: string }[]>(`select count(*)::text as n from ${table}`);
    return Number(row?.n);
  };

  beforeAll(async () => {
    url = await createFreshDatabase(testEnv.DATABASE_URL);
    await runMigrations(url);
    connection = createDatabaseConnection(url);
    sql = connection.sql;
    hardware = new HardwareRepository(connection);
    devices = new DevicesRepository(connection);
    measurements = new MeasurementsRepository(connection);
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  describe('migration', () => {
    it('turns measurements into a hypertable with 7 day chunks', async () => {
      const rows = await sql<{ compression_enabled: boolean; time_interval: string }[]>`
        select h.compression_enabled, d.time_interval::text
        from timescaledb_information.hypertables h
        join timescaledb_information.dimensions d
          on d.hypertable_name = h.hypertable_name and d.dimension_number = 1
        where h.hypertable_name = 'measurements'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.compression_enabled).toBe(true);
      expect(rows[0]?.time_interval).toBe('7 days');
    });

    it('compresses after 7 days and drops raw data after one year', async () => {
      const jobs = await sql<{ proc_name: string; config: Record<string, string> }[]>`
        select proc_name, config from timescaledb_information.jobs
        where hypertable_name = 'measurements' order by proc_name`;
      expect(jobs.map((job) => job.proc_name)).toEqual(['policy_compression', 'policy_retention']);
      expect(jobs[0]?.config['compress_after']).toBe('7 days');
      expect(jobs[1]?.config['drop_after']).toBe('1 year');
    });

    it('segments compression by device and capability', async () => {
      const rows = await sql<{ attname: string; segmentby_column_index: number | null }[]>`
        select attname, segmentby_column_index
        from timescaledb_information.compression_settings
        where hypertable_name = 'measurements' and segmentby_column_index is not null
        order by segmentby_column_index`;
      expect(rows.map((row) => row.attname)).toEqual(['device_id', 'capability']);
    });
  });

  describe('hardware', () => {
    it('stores bridge devices with their capabilities and reports what changed', async () => {
      const gatewayId = await gateway(await household());
      const first = await hardware.upsertFromBridge(
        gatewayId,
        [sensor('0x01', 'bed-1'), sensor('0x02', 'bed-2')],
        now,
      );
      expect(first).toEqual({
        upserted: 2,
        removed: 0,
        ids: [expect.any(String), expect.any(String)],
      });

      const bed1 = await hardware.findByName(gatewayId, 'bed-1');
      expect(bed1).toMatchObject({
        gatewayId,
        ieeeAddress: '0x01',
        vendor: 'Acme',
        model: 'AY-303Z',
        availability: 'unknown',
        lastState: {},
        removedAt: null,
        firstSeenAt: now,
      });
      expect(bed1?.capabilities.map((capability) => capability.key).sort()).toEqual([
        'soil_calibration',
        'soil_moisture',
      ]);
    });

    it('updates renamed hardware in place and replaces its capabilities', async () => {
      const gatewayId = await gateway(await household());
      await hardware.upsertFromBridge(gatewayId, [sensor('0x01', 'bed-1')], now);
      const before = await hardwareId(gatewayId, 'bed-1');

      const later = new Date(now.getTime() + 60_000);
      const result = await hardware.upsertFromBridge(
        gatewayId,
        [sensor('0x01', 'tomatoes', { capabilities: [numeric('battery', { unit: '%' })] })],
        later,
      );

      expect(result).toEqual({ upserted: 1, removed: 0, ids: [before] });
      expect(await hardware.findByName(gatewayId, 'bed-1')).toBeUndefined();
      const renamed = await hardware.findByName(gatewayId, 'tomatoes');
      expect(renamed?.id).toBe(before);
      expect(renamed?.firstSeenAt).toEqual(now);
      expect(renamed?.capabilities.map((capability) => capability.key)).toEqual(['battery']);
    });

    it('marks hardware that is no longer listed as removed and revives it when it returns', async () => {
      const gatewayId = await gateway(await household());
      await hardware.upsertFromBridge(gatewayId, [sensor('0x01', 'a'), sensor('0x02', 'b')], now);

      const gone = await hardware.upsertFromBridge(gatewayId, [sensor('0x01', 'a')], now);
      expect(gone).toEqual({
        upserted: 1,
        removed: 1,
        ids: [expect.any(String), expect.any(String)],
      });
      expect(await hardware.findByName(gatewayId, 'b')).toBeUndefined();
      // Listing it again does not count it as removed a second time.
      expect(await hardware.upsertFromBridge(gatewayId, [sensor('0x01', 'a')], now)).toEqual({
        upserted: 1,
        removed: 0,
        ids: [expect.any(String)],
      });

      await hardware.upsertFromBridge(gatewayId, [sensor('0x01', 'a'), sensor('0x02', 'b')], now);
      expect((await hardware.findByName(gatewayId, 'b'))?.removedAt).toBeNull();
    });

    it('removes everything when the bridge lists nothing and tolerates repeated entries', async () => {
      const gatewayId = await gateway(await household());
      await hardware.upsertFromBridge(
        gatewayId,
        [sensor('0x01', 'a'), sensor('0x01', 'a-again')],
        now,
      );
      expect((await hardware.findByName(gatewayId, 'a-again'))?.ieeeAddress).toBe('0x01');

      expect(await hardware.upsertFromBridge(gatewayId, [], now)).toEqual({
        upserted: 0,
        removed: 1,
        ids: [expect.any(String)],
      });
    });

    it('keeps the same IEEE address on two gateways apart', async () => {
      const householdId = await household();
      const one = await gateway(householdId);
      const two = await gateway(householdId);
      await hardware.upsertFromBridge(one, [sensor('0x01', 'same')], now);
      await hardware.upsertFromBridge(two, [sensor('0x01', 'same')], now);

      const a = await hardware.findByName(one, 'same');
      const b = await hardware.findByName(two, 'same');
      expect(a?.id).toBeDefined();
      expect(a?.id).not.toBe(b?.id);
    });

    it('lists unassigned hardware of the household, not of others, revoked gateways or removed', async () => {
      const mine = await household();
      const other = await household();
      const gatewayId = await gateway(mine);
      const revoked = await gateway(mine, true);
      const foreign = await gateway(other);
      await hardware.upsertFromBridge(
        gatewayId,
        [sensor('0x01', 'free'), sensor('0x02', 'taken'), sensor('0x03', 'gone')],
        now,
      );
      await hardware.upsertFromBridge(revoked, [sensor('0x04', 'revoked-gw')], now);
      await hardware.upsertFromBridge(foreign, [sensor('0x05', 'foreign')], now);
      await hardware.upsertFromBridge(
        gatewayId,
        [sensor('0x01', 'free'), sensor('0x02', 'taken')],
        now,
      );
      const taken = await hardwareId(gatewayId, 'taken');
      expect((await devices.createWithBinding(mine, taken, 'Taken')).outcome).toBe('created');

      const list = await hardware.listUnassigned(mine);

      expect(list.map((row) => row.friendlyName)).toEqual(['free']);
      expect(list[0]?.capabilities.map((capability) => capability.key).sort()).toEqual([
        'soil_calibration',
        'soil_moisture',
      ]);
    });
  });

  describe('devices', () => {
    const bound = async () => {
      const householdId = await household();
      const gatewayId = await gateway(householdId);
      await hardware.upsertFromBridge(gatewayId, [sensor('0x01', 'bed-1')], now);
      const id = await hardwareId(gatewayId, 'bed-1');
      return { householdId, gatewayId, hardwareId: id };
    };

    it('creates a device with its binding and a device state taken from the hardware', async () => {
      const { householdId, hardwareId: id } = await bound();
      await sql`update hardware set last_state = ${JSON.stringify({ soil_moisture: 41 })}::jsonb,
        availability = 'online', last_seen_at = ${now.toISOString()}::timestamptz where id = ${id}`;

      const created = await devices.createWithBinding(householdId, id, 'Tomatoes');

      expect(created.outcome).toBe('created');
      if (created.outcome !== 'created') return;
      const view = await devices.get(householdId, created.device.id);
      expect(view).toMatchObject({
        name: 'Tomatoes',
        icon: null,
        availability: 'online',
        lastSeenAt: now,
        state: { soil_moisture: 41 },
        hardware: { id, vendor: 'Acme', model: 'AY-303Z', description: 'Soil sensor' },
      });
      // Readable measurements only: the calibration setting is not part of a device.
      expect(view?.capabilities.map((capability) => capability.key)).toEqual(['soil_moisture']);
      const binding = await devices.activeBindingForHardware(id);
      expect(binding).toMatchObject({ deviceId: created.device.id, householdId });
    });

    it('refuses hardware that is bound already or belongs to somebody else', async () => {
      const { householdId, hardwareId: id } = await bound();
      expect((await devices.createWithBinding(householdId, id, 'First')).outcome).toBe('created');
      const devicesBefore = await count('devices');

      expect((await devices.createWithBinding(householdId, id, 'Second')).outcome).toBe(
        'hardware-bound',
      );
      expect((await devices.createWithBinding(await household(), id, 'Stolen')).outcome).toBe(
        'hardware-not-found',
      );
      expect(
        (await devices.createWithBinding(householdId, crypto.randomUUID(), 'None')).outcome,
      ).toBe('hardware-not-found');
      // Nothing was left behind by the failed attempts.
      expect(await count('devices')).toBe(devicesBefore);
    });

    it('lets exactly one of two concurrent requests bind the hardware', async () => {
      const { householdId, hardwareId: id } = await bound();
      const outcomes = await Promise.all([
        devices.createWithBinding(householdId, id, 'A'),
        devices.createWithBinding(householdId, id, 'B'),
      ]);
      expect(outcomes.map((result) => result.outcome).sort()).toEqual([
        'created',
        'hardware-bound',
      ]);
      const [row] = await sql<{ n: string }[]>`
        select count(*)::text as n from device_bindings
        where hardware_id = ${id} and unbound_at is null`;
      expect(row?.n).toBe('1');
    });

    it('enforces one active binding per device and per hardware in the database', async () => {
      const { householdId, gatewayId, hardwareId: id } = await bound();
      const created = await devices.createWithBinding(householdId, id, 'Tomatoes');
      if (created.outcome !== 'created') throw new Error('not created');
      await hardware.upsertFromBridge(
        gatewayId,
        [sensor('0x01', 'bed-1'), sensor('0x02', 'b')],
        now,
      );
      const second = await hardwareId(gatewayId, 'b');

      await expect(
        sql`insert into device_bindings (device_id, hardware_id)
          values (${created.device.id}, ${second})`,
      ).rejects.toMatchObject({ code: '23505' });
      const other = await sql<{ id: string }[]>`
        insert into devices (household_id, name) values (${householdId}, 'Other') returning id`;
      await expect(
        sql`insert into device_bindings (device_id, hardware_id)
          values (${other[0]?.id ?? ''}, ${id})`,
      ).rejects.toMatchObject({ code: '23505' });

      // A released binding does not block a new one.
      await sql`update device_bindings set unbound_at = now() where hardware_id = ${id}`;
      await sql`insert into device_bindings (device_id, hardware_id)
        values (${other[0]?.id ?? ''}, ${id})`;
      expect((await devices.activeBindingForHardware(id))?.deviceId).toBe(other[0]?.id);
    });

    it('lists the household devices by name and renames them within the household', async () => {
      const { householdId, gatewayId, hardwareId: id } = await bound();
      await hardware.upsertFromBridge(
        gatewayId,
        [sensor('0x01', 'bed-1'), sensor('0x02', 'b')],
        now,
      );
      const second = await hardwareId(gatewayId, 'b');
      const one = await devices.createWithBinding(householdId, id, 'Zucchini');
      const two = await devices.createWithBinding(householdId, second, 'Basil');
      if (one.outcome !== 'created' || two.outcome !== 'created') throw new Error('not created');

      expect((await devices.list(householdId)).map((device) => device.name)).toEqual([
        'Basil',
        'Zucchini',
      ]);
      expect(await devices.list(await household())).toEqual([]);

      expect(
        (await devices.update(householdId, one.device.id, { name: 'Courgette' }))?.view.name,
      ).toBe('Courgette');
      expect(
        await devices.update(await household(), one.device.id, { name: 'Hijacked' }),
      ).toBeUndefined();
      expect((await devices.get(householdId, one.device.id))?.name).toBe('Courgette');
      expect(await devices.get(await household(), one.device.id)).toBeUndefined();
    });

    it('removes devices, bindings and states with their household, but keeps the hardware rows of other households', async () => {
      const { householdId, hardwareId: id } = await bound();
      const created = await devices.createWithBinding(householdId, id, 'Tomatoes');
      if (created.outcome !== 'created') throw new Error('not created');
      const survivor = await bound();
      await devices.createWithBinding(survivor.householdId, survivor.hardwareId, 'Keeper');

      await sql`delete from households where id = ${householdId}`;

      expect(await devices.get(householdId, created.device.id)).toBeUndefined();
      const [gone] = await sql<{ n: string }[]>`
        select (
          (select count(*) from devices where household_id = ${householdId}) +
          (select count(*) from device_bindings where device_id = ${created.device.id}) +
          (select count(*) from device_state where device_id = ${created.device.id}) +
          (select count(*) from hardware where id = ${id})
        )::text as n`;
      expect(gone?.n).toBe('0');
      expect(await devices.list(survivor.householdId)).toHaveLength(1);
    });
  });

  describe('measurements', () => {
    const device = crypto.randomUUID();
    const at = (seconds: number): Date => new Date(now.getTime() + seconds * 1000);

    it('stores numeric, text and flagged readings', async () => {
      const inserted = await measurements.insertMany([
        { time: at(0), deviceId: device, capability: 'soil_moisture', valueNum: 41.5 },
        { time: at(0), deviceId: device, capability: 'effect', valueText: 'blink' },
        {
          time: at(1),
          deviceId: device,
          capability: 'soil_moisture',
          valueNum: 40,
          flags: ['time_replaced'],
        },
      ]);

      expect(inserted).toBe(3);
      const rows = await sql<{ capability: string; value_num: number | null; flags: string[] }[]>`
        select capability, value_num, flags from measurements
        where device_id = ${device} order by time, capability`;
      expect(rows).toEqual([
        { capability: 'effect', value_num: null, flags: [] },
        { capability: 'soil_moisture', value_num: 41.5, flags: [] },
        { capability: 'soil_moisture', value_num: 40, flags: ['time_replaced'] },
      ]);
    });

    it('ignores a reading that arrives twice and keeps the first value', async () => {
      const other = crypto.randomUUID();
      const reading = { time: at(5), deviceId: other, capability: 'humidity', valueNum: 50 };
      expect(await measurements.insertMany([reading])).toBe(1);

      const again = await measurements.insertMany([
        { ...reading, valueNum: 99 },
        { ...reading, time: at(6) },
      ]);

      expect(again).toBe(1);
      const rows = await sql<{ value_num: number }[]>`
        select value_num from measurements where device_id = ${other} order by time`;
      expect(rows.map((row) => row.value_num)).toEqual([50, 50]);
    });

    it('ignores a duplicate even when its chunk is compressed already', async () => {
      const old = crypto.randomUUID();
      const reading = {
        time: new Date(now.getTime() - 30 * 24 * 3600 * 1000),
        deviceId: old,
        capability: 'humidity',
        valueNum: 50,
      };
      await measurements.insertMany([reading]);
      await sql`select compress_chunk(c, if_not_compressed => true)
        from show_chunks('measurements', older_than => ${now.toISOString()}::timestamptz - interval '20 days') c`;

      const again = await measurements.insertMany([
        { ...reading, valueNum: 99 },
        { ...reading, time: new Date(reading.time.getTime() + 1000) },
      ]);

      expect(again).toBe(1);
      const rows = await sql<{ value_num: number }[]>`
        select value_num from measurements where device_id = ${old} order by time`;
      expect(rows.map((row) => row.value_num)).toEqual([50, 50]);
    });

    it('accepts an empty batch', async () => {
      expect(await measurements.insertMany([])).toBe(0);
    });

    it('survives its device: no foreign key, retention cleans up', async () => {
      const [fk] = await sql<{ n: string }[]>`
        select count(*)::text as n from information_schema.table_constraints
        where table_name = 'measurements' and constraint_type = 'FOREIGN KEY'`;
      expect(fk?.n).toBe('0');
    });
  });
});
