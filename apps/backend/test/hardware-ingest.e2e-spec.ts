import type { Capability } from '@smart/contracts';
import postgres from 'postgres';
import { inject } from 'vitest';
import {
  DevicesRepository,
  HardwareRepository,
  type Z2mDevice,
} from '../src/core/devices/index.js';
import {
  createDatabaseConnection,
  runMigrations,
  type DatabaseConnection,
} from '../src/platform/database/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';
import { randomGatewayId } from './helpers/test-pki.js';

const moisture: Capability = {
  key: 'soil_moisture',
  kind: 'numeric',
  unit: '%',
  min: null,
  max: null,
  step: null,
  enumValues: null,
  readable: true,
  writable: false,
  isSetting: false,
};

const sensor = (ieee: string, name: string): Z2mDevice => ({
  ieeeAddress: ieee,
  friendlyName: name,
  vendor: 'Acme',
  model: 'AY-303Z',
  description: null,
  definition: { model: 'AY-303Z' },
  interviewState: 'SUCCESSFUL',
  capabilities: [moisture],
});

interface HardwareRecord {
  friendly_name: string;
  interview_state: string;
  availability: string;
  last_state: Record<string, unknown>;
  last_seen_at: Date | null;
  removed_at: Date | null;
}

/** The hardware ingest's writes against the real database. */
describe('hardware writes of the device ingest', () => {
  const testEnv = inject('testEnv');
  const now = new Date('2026-10-14T10:00:00.000Z');
  const later = new Date('2026-10-14T11:00:00.000Z');
  let connection: DatabaseConnection;
  let sql: postgres.Sql;
  let hardware: HardwareRepository;
  let devices: DevicesRepository;
  let householdId: string;

  const gateway = async (): Promise<string> => {
    const id = randomGatewayId();
    await sql`
      insert into gateways (id, household_id, name, topic_prefix, cert_fingerprint, cert_expires_at)
      values (${id}, ${householdId}, 'Pi', ${`gw/${id}/z2m`}, 'fingerprint',
        now() + interval '300 days')`;
    return id;
  };
  const rowOf = async (gatewayId: string, ieee: string): Promise<HardwareRecord> => {
    const [row] = await sql<HardwareRecord[]>`
      select friendly_name, interview_state, availability, last_state, last_seen_at, removed_at
      from hardware where gateway_id = ${gatewayId} and ieee_address = ${ieee}`;
    if (!row) throw new Error(`no hardware ${ieee}`);
    // Raw queries return timestamps as text.
    return {
      ...row,
      last_seen_at: row.last_seen_at && new Date(row.last_seen_at),
      removed_at: row.removed_at && new Date(row.removed_at),
    };
  };
  const idOf = async (gatewayId: string, name: string): Promise<string> => {
    const row = await hardware.findByName(gatewayId, name);
    if (!row) throw new Error(`no hardware ${name}`);
    return row.id;
  };
  const deviceAvailability = async (deviceId: string): Promise<string | undefined> => {
    const [row] = await sql<{ availability: string }[]>`
      select availability from device_state where device_id = ${deviceId}`;
    return row?.availability;
  };
  /** A device on the hardware of that name. */
  const bound = async (gatewayId: string, name: string): Promise<string> => {
    const created = await devices.createWithBinding(
      householdId,
      await idOf(gatewayId, name),
      `${name} device`,
    );
    if (created.outcome !== 'created') throw new Error('no device');
    return created.device.id;
  };

  beforeAll(async () => {
    const url = await createFreshDatabase(testEnv.DATABASE_URL);
    await runMigrations(url);
    connection = createDatabaseConnection(url);
    sql = connection.sql;
    hardware = new HardwareRepository(connection);
    devices = new DevicesRepository(connection);
    const [household] = await sql<{ id: string }[]>`
      insert into households (name, timezone) values ('Home', 'Europe/Berlin') returning id`;
    householdId = household?.id ?? '';
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  describe('setAvailability', () => {
    it('stores it on the hardware and on the device that sits on it', async () => {
      const gatewayId = await gateway();
      await hardware.upsertFromBridge(
        gatewayId,
        [sensor('0x00000000000000a1', 'Tomatoes'), sensor('0x00000000000000a2', 'Basil')],
        now,
      );
      const deviceId = await bound(gatewayId, 'Tomatoes');
      const other = await bound(gatewayId, 'Basil');

      const touched = await hardware.setAvailability(await idOf(gatewayId, 'Tomatoes'), 'online');

      expect(touched).toEqual([{ deviceId, householdId }]);
      expect((await rowOf(gatewayId, '0x00000000000000a1')).availability).toBe('online');
      expect(await deviceAvailability(deviceId)).toBe('online');
      // Neither another device nor its hardware is touched.
      expect(await deviceAvailability(other)).toBe('unknown');
      expect((await rowOf(gatewayId, '0x00000000000000a2')).availability).toBe('unknown');

      await hardware.setAvailability(await idOf(gatewayId, 'Tomatoes'), 'offline');
      expect(await deviceAvailability(deviceId)).toBe('offline');
    });

    it('leaves the device alone once it no longer sits on the hardware', async () => {
      const gatewayId = await gateway();
      await hardware.upsertFromBridge(gatewayId, [sensor('0x00000000000000b1', 'Moved')], now);
      const deviceId = await bound(gatewayId, 'Moved');
      await sql`update device_bindings set unbound_at = now() where device_id = ${deviceId}`;

      expect(await hardware.setAvailability(await idOf(gatewayId, 'Moved'), 'online')).toEqual([]);

      expect((await rowOf(gatewayId, '0x00000000000000b1')).availability).toBe('online');
      expect(await deviceAvailability(deviceId)).toBe('unknown');
    });

    it('works for hardware without a device', async () => {
      const gatewayId = await gateway();
      await hardware.upsertFromBridge(gatewayId, [sensor('0x00000000000000c1', 'Free')], now);
      expect(await hardware.setAvailability(await idOf(gatewayId, 'Free'), 'offline')).toEqual([]);
      expect((await rowOf(gatewayId, '0x00000000000000c1')).availability).toBe('offline');
    });
  });

  describe('recordJoined (device_joined)', () => {
    it('adds hardware with a pending interview', async () => {
      const gatewayId = await gateway();
      const id = await hardware.recordJoined(gatewayId, '0x00000000000000d1', 'new one', now);
      expect(await idOf(gatewayId, 'new one')).toBe(id);
      expect(await rowOf(gatewayId, '0x00000000000000d1')).toMatchObject({
        interview_state: 'PENDING',
        availability: 'unknown',
        removed_at: null,
      });
    });

    it('revives and renames known hardware without losing what the bridge told before', async () => {
      const gatewayId = await gateway();
      await hardware.upsertFromBridge(gatewayId, [sensor('0x00000000000000d2', 'old name')], now);
      const before = await idOf(gatewayId, 'old name');
      await hardware.markLeft(gatewayId, '0x00000000000000d2', now);

      const id = await hardware.recordJoined(gatewayId, '0x00000000000000d2', 'rejoined', later);

      expect(id).toBe(before);
      expect(await rowOf(gatewayId, '0x00000000000000d2')).toMatchObject({
        friendly_name: 'rejoined',
        interview_state: 'SUCCESSFUL',
        removed_at: null,
      });
      expect((await hardware.findByName(gatewayId, 'rejoined'))?.capabilities).toHaveLength(1);
    });

    it('keeps the same address on two gateways apart', async () => {
      const [a, b] = [await gateway(), await gateway()];
      const first = await hardware.recordJoined(a, '0x00000000000000d3', 'same', now);
      const second = await hardware.recordJoined(b, '0x00000000000000d3', 'same', now);
      expect(first).not.toBe(second);
    });
  });

  describe('markLeft (device_leave)', () => {
    it('marks the hardware as removed and reports its name, once', async () => {
      const gatewayId = await gateway();
      await hardware.upsertFromBridge(gatewayId, [sensor('0x00000000000000e1', 'Leaving')], now);
      const id = await idOf(gatewayId, 'Leaving');

      expect(await hardware.markLeft(gatewayId, '0x00000000000000e1', later)).toEqual({
        id,
        friendlyName: 'Leaving',
      });
      expect((await rowOf(gatewayId, '0x00000000000000e1')).removed_at).toEqual(later);
      expect(await hardware.findByName(gatewayId, 'Leaving')).toBeUndefined();
      expect(await hardware.listNames(gatewayId)).toEqual([]);
      // Already removed: nothing more to report, and the first time stays.
      expect(await hardware.markLeft(gatewayId, '0x00000000000000e1', now)).toBeUndefined();
      expect((await rowOf(gatewayId, '0x00000000000000e1')).removed_at).toEqual(later);
    });

    it('knows nothing of an unknown address or of another gateway', async () => {
      const [a, b] = [await gateway(), await gateway()];
      await hardware.upsertFromBridge(a, [sensor('0x00000000000000e2', 'Mine')], now);
      expect(await hardware.markLeft(a, '0x00000000000000ee', now)).toBeUndefined();
      expect(await hardware.markLeft(b, '0x00000000000000e2', now)).toBeUndefined();
      expect((await rowOf(a, '0x00000000000000e2')).removed_at).toBeNull();
    });
  });

  describe('setInterviewState (device_interview)', () => {
    it('updates the hardware of that gateway only', async () => {
      const [a, b] = [await gateway(), await gateway()];
      await hardware.recordJoined(a, '0x00000000000000f1', 'joining', now);
      await hardware.recordJoined(b, '0x00000000000000f1', 'joining', now);

      const id = await hardware.setInterviewState(a, '0x00000000000000f1', 'IN_PROGRESS');

      expect(id).toBe(await idOf(a, 'joining'));

      expect((await rowOf(a, '0x00000000000000f1')).interview_state).toBe('IN_PROGRESS');
      expect((await rowOf(b, '0x00000000000000f1')).interview_state).toBe('PENDING');
    });

    it('does nothing for an address the gateway does not have', async () => {
      const gatewayId = await gateway();
      expect(
        await hardware.setInterviewState(gatewayId, '0x00000000000000f9', 'FAILED'),
      ).toBeUndefined();
      expect(await hardware.listNames(gatewayId)).toEqual([]);
    });
  });

  describe('rename (device_renamed)', () => {
    it('renames the hardware and reports its id, only if it is listed', async () => {
      const gatewayId = await gateway();
      await hardware.upsertFromBridge(gatewayId, [sensor('0x0000000000000a01', 'Before')], now);
      const id = await idOf(gatewayId, 'Before');
      expect(await hardware.rename(gatewayId, 'Before', 'After')).toBe(id);
      expect(await hardware.findByName(gatewayId, 'After')).toMatchObject({ id });
      expect(await hardware.rename(gatewayId, 'Before', 'Again')).toBeUndefined();
    });
  });

  describe('upsertFromBridge ids', () => {
    it('lists the hardware that was added, updated or removed', async () => {
      const gatewayId = await gateway();
      const first = await hardware.upsertFromBridge(
        gatewayId,
        [sensor('0x0000000000000c01', 'One'), sensor('0x0000000000000c02', 'Two')],
        now,
      );
      const one = await idOf(gatewayId, 'One');
      const two = await idOf(gatewayId, 'Two');
      expect([...first.ids].sort()).toEqual([one, two].sort());

      const second = await hardware.upsertFromBridge(
        gatewayId,
        [sensor('0x0000000000000c01', 'One')],
        later,
      );
      expect([...second.ids].sort()).toEqual([one, two].sort());
      expect((await hardware.upsertFromBridge(gatewayId, [], later)).ids).toEqual([one]);
    });
  });

  describe('listingOf', () => {
    it('gives free hardware with its household', async () => {
      const gatewayId = await gateway();
      await hardware.upsertFromBridge(gatewayId, [sensor('0x0000000000000d01', 'Free one')], now);
      const id = await idOf(gatewayId, 'Free one');
      const result = await hardware.listingOf(id);
      expect(result?.householdId).toBe(householdId);
      expect(result?.listed).toMatchObject({ id, friendlyName: 'Free one' });
      expect(result?.listed?.capabilities).toHaveLength(1);
      // It is what the household's list of new hardware shows.
      expect((await hardware.listUnassigned(householdId)).map((row) => row.id)).toContain(id);
    });

    it('is not listed once assigned, removed or when its gateway is revoked', async () => {
      const gatewayId = await gateway();
      await hardware.upsertFromBridge(
        gatewayId,
        [sensor('0x0000000000000d02', 'Assigned'), sensor('0x0000000000000d03', 'Gone')],
        now,
      );
      await bound(gatewayId, 'Assigned');
      await hardware.markLeft(gatewayId, '0x0000000000000d03', now);
      const revoked = await gateway();
      await hardware.upsertFromBridge(revoked, [sensor('0x0000000000000d04', 'Orphan')], now);
      await sql`update gateways set revoked_at = now() where id = ${revoked}`;

      for (const [id, name] of [
        [await idOf(gatewayId, 'Assigned'), 'Assigned'],
        [
          (await sql<{ id: string }[]>`select id from hardware where friendly_name = 'Gone'`)[0]
            ?.id ?? '',
          'Gone',
        ],
        [
          (await sql<{ id: string }[]>`select id from hardware where friendly_name = 'Orphan'`)[0]
            ?.id ?? '',
          'Orphan',
        ],
      ] as const) {
        expect(await hardware.listingOf(id), name).toEqual({ householdId, listed: null });
      }
    });

    it('is undefined for an unknown hardware', async () => {
      expect(await hardware.listingOf('00000000-0000-4000-8000-000000000000')).toBeUndefined();
    });
  });

  describe('recordState', () => {
    it('merges what the hardware reports into its last state and notes the time', async () => {
      const gatewayId = await gateway();
      await hardware.upsertFromBridge(gatewayId, [sensor('0x0000000000000b01', 'Reporter')], now);
      const id = await idOf(gatewayId, 'Reporter');

      await hardware.recordState(id, { soil_moisture: 30, battery: 90 }, now);
      await hardware.recordState(id, { soil_moisture: 35, label: 'it\'s "quoted"' }, later);

      expect(await rowOf(gatewayId, '0x0000000000000b01')).toMatchObject({
        last_state: { soil_moisture: 35, battery: 90, label: 'it\'s "quoted"' },
        last_seen_at: later,
      });
    });
  });
});
