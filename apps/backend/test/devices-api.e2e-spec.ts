import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  apiErrorSchema,
  deviceSchema,
  hardwareSchema,
  meSchema,
  type Device,
  type Hardware,
} from '@smart/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import {
  DEVICE_CHANGED,
  DEVICE_THRESHOLDS_CHANGED,
  DeviceEvents,
  HARDWARE_CHANGED,
} from '../src/core/devices/index.js';
import { SESSION_COOKIE, SessionService, UsersRepository } from '../src/core/identity/index.js';
import {
  DATABASE,
  type DatabaseConnection,
  runMigrations,
} from '../src/platform/database/index.js';
import { MQTT_CONNECTION, type MqttConnection } from '../src/platform/mqtt/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';

const HOUSEHOLDS = '/api/v1/households';
const UNKNOWN_ID = '3b241101-e2bb-4255-8caf-4136c566a962';

interface Person {
  id: string;
  cookie: string;
}
interface Household {
  id: string;
  owner: Person;
  member: Person;
  viewer: Person;
  gatewayId: string;
}

describe('hardware and devices of a household', () => {
  let app: INestApplication<App>;
  let connection: DatabaseConnection;
  let counter = 0;
  const originalUrl = inject('testEnv').DATABASE_URL;
  const origin = inject('testEnv').APP_ORIGIN;

  const signedIn = async (): Promise<Person> => {
    const email = `devices${(counter += 1)}@example.org`;
    const user = await app
      .get(UsersRepository)
      .create({ email, displayName: `Devices ${counter}` });
    const { token } = await app.get(SessionService).create(user.id, 'email_code', 'Browser/1');
    return { id: user.id, cookie: `${SESSION_COOKIE}=${token}` };
  };
  const get = (path: string, who: Person) =>
    request(app.getHttpServer()).get(path).set('Cookie', who.cookie);
  const post = (path: string, who: Person, body: object) =>
    request(app.getHttpServer())
      .post(path)
      .set('Cookie', who.cookie)
      .set('Origin', origin)
      .send(body);
  const patch = (path: string, who: Person, body: object) =>
    request(app.getHttpServer())
      .patch(path)
      .set('Cookie', who.cookie)
      .set('Origin', origin)
      .send(body);
  const errorCode = (response: request.Response): string =>
    apiErrorSchema.parse(response.body).code;

  const household = async (): Promise<Household> => {
    const owner = await signedIn();
    const member = await signedIn();
    const viewer = await signedIn();
    const created = await post(HOUSEHOLDS, owner, {
      name: 'Home',
      timezone: 'Europe/Berlin',
    }).expect(201);
    const id = meSchema.parse(created.body).currentHouseholdId;
    if (!id) throw new Error('no current household');
    await connection.sql`
      insert into memberships (household_id, user_id, role)
      values (${id}, ${member.id}, 'member'), (${id}, ${viewer.id}, 'viewer')`;
    const gatewayId = `gw-${randomBytes(4).toString('hex')}`;
    await connection.sql`
      insert into gateways (id, household_id, name, topic_prefix, cert_fingerprint, cert_expires_at)
      values (${gatewayId}, ${id}, 'Pi', ${`gw/${gatewayId}/z2m`}, 'fingerprint',
        now() + interval '1 year')`;
    return { id, owner, member, viewer, gatewayId };
  };

  /** Hardware of a gateway with a measurement, a setting and a write-only capability. */
  const addHardware = async (
    gatewayId: string,
    name: string,
    lastState: object = { soil_moisture: 41, battery: 88 },
  ): Promise<string> => {
    const [row] = await connection.sql<{ id: string }[]>`
      insert into hardware (gateway_id, ieee_address, friendly_name, vendor, model, availability,
        last_state, first_seen_at, last_seen_at)
      values (${gatewayId}, ${`0x${randomBytes(8).toString('hex')}`}, ${name}, 'Acme', 'AY-303Z',
        'online', ${JSON.stringify(lastState)}::jsonb, now(), '2026-10-14T11:00:00Z')
      returning id`;
    if (!row) throw new Error('no hardware');
    await connection.sql`
      insert into capabilities (hardware_id, key, kind, unit, readable, writable, is_setting)
      values (${row.id}, 'soil_moisture', 'numeric', '%', true, false, false),
        (${row.id}, 'battery', 'numeric', '%', true, false, false),
        (${row.id}, 'calibration', 'numeric', null, true, true, true),
        (${row.id}, 'identify', 'enum', null, false, true, false)`;
    return row.id;
  };

  const counts = async (householdId: string): Promise<{ devices: number; bindings: number }> => {
    const [row] = await connection.sql<{ devices: number; bindings: number }[]>`
      select (select count(*) from devices where household_id = ${householdId})::int as devices,
        (select count(*) from device_bindings b join devices d on d.id = b.device_id
          where d.household_id = ${householdId})::int as bindings`;
    return row ?? { devices: -1, bindings: -1 };
  };

  beforeAll(async () => {
    const url = await createFreshDatabase(originalUrl);
    await runMigrations(url);
    process.env.DATABASE_URL = url;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    configureApp(app);
    await app.init();
    await app.get<MqttConnection>(MQTT_CONNECTION).waitUntilConnected(5000);
    connection = app.get<DatabaseConnection>(DATABASE);
  });

  afterAll(async () => {
    await app.close();
    process.env.DATABASE_URL = originalUrl;
  });

  describe('GET /hardware?state=unassigned', () => {
    it('lists the unassigned hardware of the household for owners with its preview', async () => {
      const h = await household();
      const hardwareId = await addHardware(h.gatewayId, 'bed-1');
      const response = await get(`${HOUSEHOLDS}/${h.id}/hardware?state=unassigned`, h.owner).expect(
        200,
      );
      const list: Hardware[] = (response.body as unknown[]).map((item) =>
        hardwareSchema.parse(item),
      );
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id: hardwareId,
        gatewayId: h.gatewayId,
        friendlyName: 'bed-1',
        vendor: 'Acme',
        availability: 'online',
        lastSeenAt: '2026-10-14T11:00:00.000Z',
        lastState: { soil_moisture: 41, battery: 88 },
      });
      expect(list[0]?.capabilities.map((c) => c.key)).toEqual([
        'battery',
        'calibration',
        'identify',
        'soil_moisture',
      ]);
    });

    it('leaves out bound, removed and revoked-gateway hardware and foreign hardware', async () => {
      const h = await household();
      const other = await household();
      const bound = await addHardware(h.gatewayId, 'bound');
      const removed = await addHardware(h.gatewayId, 'removed');
      await connection.sql`update hardware set removed_at = now() where id = ${removed}`;
      await addHardware(other.gatewayId, 'foreign');
      const free = await addHardware(h.gatewayId, 'free');
      await post(`${HOUSEHOLDS}/${h.id}/devices`, h.owner, {
        hardwareId: bound,
        name: 'Bed',
      }).expect(201);
      const revokedGateway = `gw-${randomBytes(4).toString('hex')}`;
      await connection.sql`
        insert into gateways (id, household_id, name, topic_prefix, cert_fingerprint,
          cert_expires_at, revoked_at)
        values (${revokedGateway}, ${h.id}, 'Old', ${`gw/${revokedGateway}/z2m`}, 'fingerprint',
          now() + interval '1 year', now())`;
      await addHardware(revokedGateway, 'on-revoked');
      const response = await get(`${HOUSEHOLDS}/${h.id}/hardware?state=unassigned`, h.owner).expect(
        200,
      );
      expect((response.body as Hardware[]).map((item) => item.id)).toEqual([free]);
    });

    it('is for owners only', async () => {
      const h = await household();
      for (const who of [h.member, h.viewer]) {
        const response = await get(`${HOUSEHOLDS}/${h.id}/hardware?state=unassigned`, who).expect(
          403,
        );
        expect(errorCode(response)).toBe('household.forbidden');
      }
    });

    it.each(['', '?state=all', '?state=bound'])(
      'rejects the query "%s" with 400',
      async (query) => {
        const h = await household();
        const response = await get(`${HOUSEHOLDS}/${h.id}/hardware${query}`, h.owner).expect(400);
        expect(errorCode(response)).toBe('validation.failed');
      },
    );
  });

  describe('POST /devices', () => {
    it('turns hardware into a device with the state of the hardware', async () => {
      const h = await household();
      const hardwareId = await addHardware(h.gatewayId, 'bed-1');
      const response = await post(`${HOUSEHOLDS}/${h.id}/devices`, h.owner, {
        hardwareId,
        name: ' Bed 1 ',
      }).expect(201);
      const created: Device = deviceSchema.parse(response.body);
      expect(created).toMatchObject({
        name: 'Bed 1',
        icon: null,
        hardware: { id: hardwareId, vendor: 'Acme', model: 'AY-303Z', description: null },
        availability: 'online',
        lastSeenAt: '2026-10-14T11:00:00.000Z',
        state: { soil_moisture: 41, battery: 88 },
      });
      // Settings and write-only capabilities are not shown.
      expect(created.capabilities.map((c) => c.key)).toEqual(['battery', 'soil_moisture']);

      const list = await get(`${HOUSEHOLDS}/${h.id}/devices`, h.viewer).expect(200);
      expect((list.body as Device[]).map((device) => deviceSchema.parse(device))).toEqual([
        created,
      ]);
      const one = await get(`${HOUSEHOLDS}/${h.id}/devices/${created.id}`, h.viewer).expect(200);
      expect(deviceSchema.parse(one.body)).toEqual(created);
      const unassigned = await get(`${HOUSEHOLDS}/${h.id}/hardware?state=unassigned`, h.owner);
      expect(unassigned.body).toEqual([]);
    });

    it('announces the device and the hardware that is assigned now', async () => {
      const h = await household();
      const hardwareId = await addHardware(h.gatewayId, 'bed-1');
      const log: [string, unknown][] = [];
      const bus = app.get(DeviceEvents);
      const listeners = [DEVICE_CHANGED, HARDWARE_CHANGED].map((name) => {
        const listener = (event: unknown) => log.push([name, event]);
        bus.on(name, listener);
        return [name, listener] as const;
      });
      try {
        const response = await post(`${HOUSEHOLDS}/${h.id}/devices`, h.owner, {
          hardwareId,
          name: 'Bed',
        }).expect(201);
        const created = deviceSchema.parse(response.body);
        expect(log).toEqual([
          [DEVICE_CHANGED, { householdId: h.id, deviceId: created.id }],
          [HARDWARE_CHANGED, { hardwareId }],
        ]);
        await patch(`${HOUSEHOLDS}/${h.id}/devices/${created.id}`, h.owner, {
          name: 'Roses',
        }).expect(200);
        expect(log).toHaveLength(3);
        expect(log[2]).toEqual([DEVICE_CHANGED, { householdId: h.id, deviceId: created.id }]);
      } finally {
        for (const [name, listener] of listeners) bus.off(name, listener);
      }
    });

    it('is for owners only and creates nothing for members', async () => {
      const h = await household();
      const hardwareId = await addHardware(h.gatewayId, 'bed-1');
      for (const who of [h.member, h.viewer]) {
        const response = await post(`${HOUSEHOLDS}/${h.id}/devices`, who, {
          hardwareId,
          name: 'Bed',
        }).expect(403);
        expect(errorCode(response)).toBe('household.forbidden');
      }
      expect(await counts(h.id)).toEqual({ devices: 0, bindings: 0 });
    });

    it('answers hardware of another household, an unknown or malformed ID with 404', async () => {
      const h = await household();
      const other = await household();
      const foreign = await addHardware(other.gatewayId, 'foreign');
      const removed = await addHardware(h.gatewayId, 'removed');
      await connection.sql`update hardware set removed_at = now() where id = ${removed}`;
      for (const hardwareId of [foreign, removed, UNKNOWN_ID, 'not-a-uuid']) {
        const response = await post(`${HOUSEHOLDS}/${h.id}/devices`, h.owner, {
          hardwareId,
          name: 'Bed',
        }).expect(404);
        expect(errorCode(response)).toBe('household.notFound');
      }
      expect(await counts(h.id)).toEqual({ devices: 0, bindings: 0 });
      expect(await counts(other.id)).toEqual({ devices: 0, bindings: 0 });
    });

    it('answers hardware that is bound already with 409 device.hardwareBound', async () => {
      const h = await household();
      const hardwareId = await addHardware(h.gatewayId, 'bed-1');
      const url = `${HOUSEHOLDS}/${h.id}/devices`;
      await post(url, h.owner, { hardwareId, name: 'Bed' }).expect(201);
      const response = await post(url, h.owner, { hardwareId, name: 'Again' }).expect(409);
      expect(errorCode(response)).toBe('device.hardwareBound');
      expect(await counts(h.id)).toEqual({ devices: 1, bindings: 1 });
    });

    it('lets exactly one of two simultaneous requests win', async () => {
      const h = await household();
      const hardwareId = await addHardware(h.gatewayId, 'bed-1');
      const url = `${HOUSEHOLDS}/${h.id}/devices`;
      const responses = await Promise.all([
        post(url, h.owner, { hardwareId, name: 'First' }),
        post(url, h.owner, { hardwareId, name: 'Second' }),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      const loser = responses.find((response) => response.status === 409);
      expect(loser && errorCode(loser)).toBe('device.hardwareBound');
      expect(await counts(h.id)).toEqual({ devices: 1, bindings: 1 });
    });

    it.each([
      ['a blank name', { name: '   ' }],
      ['a missing name', {}],
    ])('rejects %s with 400', async (_label, extra) => {
      const h = await household();
      const hardwareId = await addHardware(h.gatewayId, 'bed-1');
      const response = await post(`${HOUSEHOLDS}/${h.id}/devices`, h.owner, {
        hardwareId,
        ...extra,
      }).expect(400);
      expect(errorCode(response)).toBe('validation.failed');
      expect(await counts(h.id)).toEqual({ devices: 0, bindings: 0 });
    });
  });

  describe('GET /devices', () => {
    it('lists the devices by name with an empty state and unknown availability when unseen', async () => {
      const h = await household();
      const zebra = await addHardware(h.gatewayId, 'zebra');
      const apple = await addHardware(h.gatewayId, 'apple', {});
      await connection.sql`
        update hardware set availability = 'unknown', last_seen_at = null where id = ${apple}`;
      for (const [hardwareId, name] of [
        [zebra, 'Zebra'],
        [apple, 'Apple'],
      ] as const) {
        await post(`${HOUSEHOLDS}/${h.id}/devices`, h.owner, { hardwareId, name }).expect(201);
      }
      const response = await get(`${HOUSEHOLDS}/${h.id}/devices`, h.viewer).expect(200);
      const list = (response.body as unknown[]).map((item) => deviceSchema.parse(item));
      expect(list.map((device) => device.name)).toEqual(['Apple', 'Zebra']);
      expect(list[0]).toMatchObject({ availability: 'unknown', lastSeenAt: null, state: {} });
    });

    it('shows nothing of other households and answers a foreign device with 404', async () => {
      const h = await household();
      const other = await household();
      const hardwareId = await addHardware(other.gatewayId, 'bed');
      const created = await post(`${HOUSEHOLDS}/${other.id}/devices`, other.owner, {
        hardwareId,
        name: 'Theirs',
      }).expect(201);
      const deviceId = deviceSchema.parse(created.body).id;
      expect((await get(`${HOUSEHOLDS}/${h.id}/devices`, h.owner).expect(200)).body).toEqual([]);
      for (const id of [deviceId, UNKNOWN_ID, 'not-a-uuid']) {
        const response = await get(`${HOUSEHOLDS}/${h.id}/devices/${id}`, h.owner).expect(404);
        expect(errorCode(response)).toBe('household.notFound');
      }
    });
  });

  describe('PATCH /devices/:deviceId', () => {
    it('renames as member and as owner, and answers with the device', async () => {
      const h = await household();
      const hardwareId = await addHardware(h.gatewayId, 'bed-1');
      const created = await post(`${HOUSEHOLDS}/${h.id}/devices`, h.owner, {
        hardwareId,
        name: 'Bed',
      }).expect(201);
      const device = deviceSchema.parse(created.body);
      const url = `${HOUSEHOLDS}/${h.id}/devices/${device.id}`;
      const renamed = await patch(url, h.member, { name: ' Roses ' }).expect(200);
      expect(deviceSchema.parse(renamed.body)).toEqual({ ...device, name: 'Roses' });
      await patch(url, h.owner, { name: 'Tomatoes' }).expect(200);
      const read = await get(url, h.viewer).expect(200);
      expect(deviceSchema.parse(read.body).name).toBe('Tomatoes');
    });

    it('answers a device without an active binding, which is not shown, with 404', async () => {
      const h = await household();
      const hardwareId = await addHardware(h.gatewayId, 'bed-1');
      const created = await post(`${HOUSEHOLDS}/${h.id}/devices`, h.owner, {
        hardwareId,
        name: 'Bed',
      }).expect(201);
      const id = deviceSchema.parse(created.body).id;
      await connection.sql`update device_bindings set unbound_at = now() where device_id = ${id}`;
      const url = `${HOUSEHOLDS}/${h.id}/devices/${id}`;
      await get(url, h.owner).expect(404);
      await patch(url, h.owner, { name: 'Renamed' }).expect(404);
      const [row] = await connection.sql<
        { name: string }[]
      >`select name from devices where id = ${id}`;
      expect(row?.name).toBe('Bed');
    });

    it('answers a viewer with 403 and changes nothing', async () => {
      const h = await household();
      const hardwareId = await addHardware(h.gatewayId, 'bed-1');
      const created = await post(`${HOUSEHOLDS}/${h.id}/devices`, h.owner, {
        hardwareId,
        name: 'Bed',
      }).expect(201);
      const url = `${HOUSEHOLDS}/${h.id}/devices/${deviceSchema.parse(created.body).id}`;
      const response = await patch(url, h.viewer, { name: 'Hijacked' }).expect(403);
      expect(errorCode(response)).toBe('household.forbidden');
      expect(deviceSchema.parse((await get(url, h.owner)).body).name).toBe('Bed');
    });

    it('rejects a blank name with 400 and answers unknown or foreign devices with 404', async () => {
      const h = await household();
      const other = await household();
      const hardwareId = await addHardware(other.gatewayId, 'bed');
      const created = await post(`${HOUSEHOLDS}/${other.id}/devices`, other.owner, {
        hardwareId,
        name: 'Theirs',
      }).expect(201);
      const foreign = deviceSchema.parse(created.body).id;
      for (const id of [foreign, UNKNOWN_ID, 'not-a-uuid']) {
        const response = await patch(`${HOUSEHOLDS}/${h.id}/devices/${id}`, h.owner, {
          name: 'Mine',
        }).expect(404);
        expect(errorCode(response)).toBe('household.notFound');
      }
      const own = await addHardware(h.gatewayId, 'bed-2');
      const device = deviceSchema.parse(
        (await post(`${HOUSEHOLDS}/${h.id}/devices`, h.owner, { hardwareId: own, name: 'Own' }))
          .body,
      );
      const blank = await patch(`${HOUSEHOLDS}/${h.id}/devices/${device.id}`, h.owner, {
        name: '  ',
      }).expect(400);
      expect(errorCode(blank)).toBe('validation.failed');
      const theirs = await get(`${HOUSEHOLDS}/${other.id}/devices/${foreign}`, other.owner);
      expect(deviceSchema.parse(theirs.body).name).toBe('Theirs');
    });
  });

  describe('thresholds per device', () => {
    const DEFAULTS = {
      soilMoistureMin: 25,
      soilMoistureMax: null,
      batteryMin: 20,
      contactOpenMinutes: 10,
      silentMinutes: 120,
    };

    /** A soil device of a new household, with its URL. */
    const soilDevice = async (): Promise<{ h: Household; device: Device; url: string }> => {
      const h = await household();
      const hardwareId = await addHardware(h.gatewayId, 'bed-1');
      const created = await post(`${HOUSEHOLDS}/${h.id}/devices`, h.owner, {
        hardwareId,
        name: 'Bed',
      }).expect(201);
      const device = deviceSchema.parse(created.body);
      return { h, device, url: `${HOUSEHOLDS}/${h.id}/devices/${device.id}` };
    };

    it('shows the default of the kind when nothing is set', async () => {
      const { device } = await soilDevice();
      expect(device.thresholds).toEqual({});
      expect(device.effectiveThresholds).toEqual(DEFAULTS);
    });

    it('shows the default of a climate device without a soil minimum', async () => {
      const h = await household();
      const [row] = await connection.sql<{ id: string }[]>`
        insert into hardware (gateway_id, ieee_address, friendly_name, first_seen_at)
        values (${h.gatewayId}, '0xclimate', 'room', now()) returning id`;
      await connection.sql`
        insert into capabilities (hardware_id, key, kind, readable, writable, is_setting)
        values (${row?.id}, 'temperature', 'numeric', true, false, false)`;
      const created = await post(`${HOUSEHOLDS}/${h.id}/devices`, h.owner, {
        hardwareId: row?.id,
        name: 'Room',
      }).expect(201);
      expect(deviceSchema.parse(created.body).effectiveThresholds).toEqual({
        ...DEFAULTS,
        soilMoistureMin: null,
      });
    });

    it('stores set values, keeps the others and lets null reset one', async () => {
      const { h, url } = await soilDevice();
      const first = await patch(url, h.member, {
        thresholds: { soilMoistureMin: 30, batteryMin: 15 },
      }).expect(200);
      expect(deviceSchema.parse(first.body)).toMatchObject({
        name: 'Bed',
        thresholds: { soilMoistureMin: 30, batteryMin: 15 },
        effectiveThresholds: { ...DEFAULTS, soilMoistureMin: 30, batteryMin: 15 },
      });
      const second = await patch(url, h.owner, {
        thresholds: { soilMoistureMax: 80, batteryMin: null },
      }).expect(200);
      expect(deviceSchema.parse(second.body)).toMatchObject({
        thresholds: { soilMoistureMin: 30, soilMoistureMax: 80 },
        effectiveThresholds: { ...DEFAULTS, soilMoistureMin: 30, soilMoistureMax: 80 },
      });
      const read = deviceSchema.parse((await get(url, h.viewer).expect(200)).body);
      expect(read.thresholds).toEqual({ soilMoistureMin: 30, soilMoistureMax: 80 });
      const reset = await patch(url, h.owner, {
        thresholds: { soilMoistureMin: null, soilMoistureMax: null },
      }).expect(200);
      expect(deviceSchema.parse(reset.body)).toMatchObject({
        thresholds: {},
        effectiveThresholds: DEFAULTS,
      });
    });

    it('changes the name and the thresholds together', async () => {
      const { h, url } = await soilDevice();
      const response = await patch(url, h.owner, {
        name: 'Roses',
        thresholds: { silentMinutes: 60 },
      }).expect(200);
      expect(deviceSchema.parse(response.body)).toMatchObject({
        name: 'Roses',
        thresholds: { silentMinutes: 60 },
      });
    });

    it.each([
      ['a minimum above the maximum', { soilMoistureMin: 60, soilMoistureMax: 40 }],
      ['equal minimum and maximum', { soilMoistureMin: 40, soilMoistureMax: 40 }],
      ['a percentage above 100', { soilMoistureMax: 101 }],
      ['a negative percentage', { batteryMin: -1 }],
      ['a minimum of 0 minutes', { silentMinutes: 0 }],
      ['more minutes than a week', { contactOpenMinutes: 10081 }],
      ['a fractional number of minutes', { silentMinutes: 1.5 }],
      ['a string', { batteryMin: '10' }],
    ])('rejects %s with 400', async (_label, thresholds) => {
      const { h, url } = await soilDevice();
      const response = await patch(url, h.owner, { thresholds }).expect(400);
      expect(errorCode(response)).toBe('validation.failed');
      expect(deviceSchema.parse((await get(url, h.owner)).body).thresholds).toEqual({});
    });

    it('rejects an empty change with 400', async () => {
      const { h, url } = await soilDevice();
      await patch(url, h.owner, {}).expect(400);
    });

    it('rejects a maximum below the default minimum, and a minimum above the stored maximum', async () => {
      const { h, url } = await soilDevice();
      const events: unknown[] = [];
      const listener = (event: unknown) => events.push(event);
      app.get(DeviceEvents).on(DEVICE_THRESHOLDS_CHANGED, listener);
      try {
        const low = await patch(url, h.owner, { thresholds: { soilMoistureMax: 20 } }).expect(400);
        expect(errorCode(low)).toBe('validation.failed');
        await patch(url, h.owner, {
          thresholds: { soilMoistureMin: 10, soilMoistureMax: 20 },
        }).expect(200);
        const high = await patch(url, h.owner, { thresholds: { soilMoistureMin: 30 } }).expect(400);
        expect(errorCode(high)).toBe('validation.failed');
        const read = deviceSchema.parse((await get(url, h.owner)).body);
        expect(read.thresholds).toEqual({ soilMoistureMin: 10, soilMoistureMax: 20 });
        expect(events).toHaveLength(1);
      } finally {
        app.get(DeviceEvents).off(DEVICE_THRESHOLDS_CHANGED, listener);
      }
    });

    it('announces a change of thresholds, but not a rename or an unchanged value', async () => {
      const { h, device, url } = await soilDevice();
      const events: unknown[] = [];
      const listener = (event: unknown) => events.push(event);
      app.get(DeviceEvents).on(DEVICE_THRESHOLDS_CHANGED, listener);
      try {
        await patch(url, h.owner, { name: 'Renamed' }).expect(200);
        expect(events).toEqual([]);
        await patch(url, h.owner, { thresholds: { batteryMin: 10 } }).expect(200);
        await patch(url, h.owner, { thresholds: { batteryMin: 10 } }).expect(200);
        expect(events).toEqual([{ householdId: h.id, deviceId: device.id }]);
      } finally {
        app.get(DeviceEvents).off(DEVICE_THRESHOLDS_CHANGED, listener);
      }
    });

    it('keeps both of two simultaneous changes of different thresholds', async () => {
      const { h, url } = await soilDevice();
      const responses = await Promise.all([
        patch(url, h.owner, { thresholds: { batteryMin: 10 } }),
        patch(url, h.member, { thresholds: { silentMinutes: 30 } }),
      ]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(deviceSchema.parse((await get(url, h.owner)).body).thresholds).toEqual({
        batteryMin: 10,
        silentMinutes: 30,
      });
    });

    it('answers a viewer with 403 and changes nothing', async () => {
      const { h, url } = await soilDevice();
      const response = await patch(url, h.viewer, { thresholds: { batteryMin: 5 } }).expect(403);
      expect(errorCode(response)).toBe('household.forbidden');
      expect(deviceSchema.parse((await get(url, h.owner)).body).thresholds).toEqual({});
    });

    it('answers a device of another household with 404 and changes nothing', async () => {
      const { h, device, url } = await soilDevice();
      const other = await household();
      const foreignUrl = `${HOUSEHOLDS}/${other.id}/devices/${device.id}`;
      const response = await patch(foreignUrl, other.owner, {
        thresholds: { batteryMin: 5 },
      }).expect(404);
      expect(errorCode(response)).toBe('household.notFound');
      await patch(`${HOUSEHOLDS}/${other.id}/devices/not-a-uuid`, other.owner, {
        thresholds: { batteryMin: 5 },
      }).expect(404);
      expect(deviceSchema.parse((await get(url, h.owner)).body).thresholds).toEqual({});
    });
  });
});
