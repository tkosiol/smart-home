import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  apiErrorSchema,
  deviceHistorySchema,
  deviceSchema,
  meSchema,
  type DeviceHistory,
} from '@smart/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import {
  CLOCK,
  SESSION_COOKIE,
  SessionService,
  UsersRepository,
} from '../src/core/identity/index.js';
import {
  DATABASE,
  type DatabaseConnection,
  runMigrations,
} from '../src/platform/database/index.js';
import { MQTT_CONNECTION, type MqttConnection } from '../src/platform/mqtt/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';

const HOUSEHOLDS = '/api/v1/households';
const UNKNOWN_ID = '3b241101-e2bb-4255-8caf-4136c566a962';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The clock of the app under test: fixed so that dates in the tests stay inside the ranges. */
const NOW = Date.parse('2026-10-27T12:00:00Z');

interface Person {
  id: string;
  cookie: string;
}
interface Fixture {
  householdId: string;
  owner: Person;
  viewer: Person;
  deviceId: string;
}

describe('device history API', () => {
  let app: INestApplication<App>;
  let connection: DatabaseConnection;
  let counter = 0;
  const originalUrl = inject('testEnv').DATABASE_URL;
  const origin = inject('testEnv').APP_ORIGIN;

  const signedIn = async (): Promise<Person> => {
    const email = `history${(counter += 1)}@example.org`;
    const user = await app
      .get(UsersRepository)
      .create({ email, displayName: `History ${counter}` });
    const { token } = await app.get(SessionService).create(user.id, 'email_code', 'Browser/1');
    return { id: user.id, cookie: `${SESSION_COOKIE}=${token}` };
  };
  const get = (path: string, who: Person) =>
    request(app.getHttpServer()).get(path).set('Cookie', who.cookie);
  const errorCode = (response: request.Response): string =>
    apiErrorSchema.parse(response.body).code;

  async function fixture(timezone = 'Europe/Berlin'): Promise<Fixture> {
    const owner = await signedIn();
    const viewer = await signedIn();
    const created = await request(app.getHttpServer())
      .post(HOUSEHOLDS)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send({ name: 'Home', timezone })
      .expect(201);
    const householdId = meSchema.parse(created.body).currentHouseholdId;
    if (!householdId) throw new Error('no current household');
    await connection.sql`
      insert into memberships (household_id, user_id, role) values (${householdId}, ${viewer.id}, 'viewer')`;
    const gatewayId = `gw-${randomBytes(4).toString('hex')}`;
    await connection.sql`
      insert into gateways (id, household_id, name, topic_prefix, cert_fingerprint, cert_expires_at)
      values (${gatewayId}, ${householdId}, 'Pi', ${`gw/${gatewayId}/z2m`}, 'fingerprint',
        now() + interval '1 year')`;
    const [row] = await connection.sql<{ id: string }[]>`
      insert into hardware (gateway_id, ieee_address, friendly_name, vendor, model, availability,
        last_state, first_seen_at, last_seen_at)
      values (${gatewayId}, ${`0x${randomBytes(8).toString('hex')}`}, 'bed', 'Acme', 'AY-303Z',
        'online', '{}'::jsonb, now(), now())
      returning id`;
    if (!row) throw new Error('no hardware');
    await connection.sql`
      insert into capabilities (hardware_id, key, kind, unit, readable, writable, is_setting)
      values (${row.id}, 'soil_moisture', 'numeric', '%', true, false, false),
        (${row.id}, 'calibration', 'numeric', null, true, true, true),
        (${row.id}, 'contact', 'binary', null, true, false, false)`;
    const device = await request(app.getHttpServer())
      .post(`${HOUSEHOLDS}/${householdId}/devices`)
      .set('Cookie', owner.cookie)
      .set('Origin', origin)
      .send({ hardwareId: row.id, name: 'Bed' })
      .expect(201);
    return { householdId, owner, viewer, deviceId: deviceSchema.parse(device.body).id };
  }

  async function insert(f: Fixture, at: number, value: number, capability = 'soil_moisture') {
    await connection.sql`insert into measurements (time, device_id, capability, value_num)
      values (${new Date(at).toISOString()}, ${f.deviceId}, ${capability}, ${value})`;
  }

  const history = async (
    f: Fixture,
    query: string,
    who: Person = f.owner,
  ): Promise<DeviceHistory> => {
    const response = await get(
      `${HOUSEHOLDS}/${f.householdId}/devices/${f.deviceId}/history?${query}`,
      who,
    ).expect(200);
    return deviceHistorySchema.parse(response.body);
  };

  beforeAll(async () => {
    const url = await createFreshDatabase(originalUrl);
    await runMigrations(url);
    process.env.DATABASE_URL = url;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(() => new Date(NOW))
      .compile();
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

  it('returns empty arrays without readings', async () => {
    const f = await fixture();
    const result = await history(f, 'capability=soil_moisture&range=24h');
    expect(result).toMatchObject({
      capability: 'soil_moisture',
      unit: '%',
      range: '24h',
      resolution: '15m',
      points: [],
      days: [],
    });
    expect(Date.parse(result.to) - Date.parse(result.from)).toBe(DAY);
  });

  it('serves 15 minute buckets for 24h and no days', async () => {
    const f = await fixture();
    const now = NOW;
    const slot = Math.floor((now - 2 * HOUR) / (15 * 60_000)) * 15 * 60_000;
    await insert(f, slot + 60_000, 10);
    await insert(f, slot + 120_000, 30);
    await insert(f, slot + 16 * 60_000, 50);
    await insert(f, now - 3 * DAY, 99);
    await insert(f, now - 2 * HOUR, 1, 'calibration');
    const result = await history(f, 'capability=soil_moisture&range=24h');
    expect(result.resolution).toBe('15m');
    expect(result.points).toEqual([
      { t: new Date(slot).toISOString(), avg: 20, min: 10, max: 30, last: 30 },
      { t: new Date(slot + 15 * 60_000).toISOString(), avg: 50, min: 50, max: 50, last: 50 },
    ]);
    expect(result.days).toEqual([]);
  });

  it('serves hourly values for 7d', async () => {
    const f = await fixture();
    const hour = Math.floor((NOW - 3 * DAY) / HOUR) * HOUR;
    await insert(f, hour + 60_000, 10);
    await insert(f, hour + 120_000, 20);
    await insert(f, hour + HOUR + 60_000, 40);
    const result = await history(f, 'capability=soil_moisture&range=7d');
    expect(result.resolution).toBe('1h');
    expect(result.points).toEqual([
      { t: new Date(hour).toISOString(), avg: 15, min: 10, max: 20, last: 20 },
      { t: new Date(hour + HOUR).toISOString(), avg: 40, min: 40, max: 40, last: 40 },
    ]);
    expect(result.days).toHaveLength(1);
    expect(result.days[0]).toMatchObject({ min: 10, max: 40, last: 40 });
  });

  it('adds days for 28d', async () => {
    const f = await fixture();
    const result = await history(f, 'capability=soil_moisture&range=28d');
    expect(result.resolution).toBe('1h');
    expect(result.days).toEqual([]);
    await insert(f, NOW - 10 * DAY, 10);
    const filled = await history(f, 'capability=soil_moisture&range=28d');
    expect(filled.days).toHaveLength(1);
    expect(filled.days[0]).toMatchObject({ avg: 10, min: 10, max: 10, last: 10, partial: false });
  });

  it('builds the 25 hour day of the end of summer time from 25 hourly buckets', async () => {
    const f = await fixture('Europe/Berlin');
    const start = Date.parse('2026-10-24T22:00:00Z');
    for (let i = 0; i < 25; i++) await insert(f, start + i * HOUR + 60_000, i);
    const result = await history(f, 'capability=soil_moisture&range=28d');
    const day = result.days.filter((d) => d.date === '2026-10-25');
    expect(day).toEqual([
      { date: '2026-10-25', avg: 12, min: 0, max: 24, last: 24, partial: false },
    ]);
    expect(result.days).toHaveLength(1);
    expect(result.points).toHaveLength(25);
  });

  it('starts days at local midnight in a zone with a 45 minute offset', async () => {
    const f = await fixture('Pacific/Chatham');
    // Chatham summer time is UTC+13:45: 2026-10-19T10:15Z is local midnight of the 20th. Hourly
    // buckets do not align with that offset; a bucket belongs to the day its start falls in.
    await insert(f, Date.parse('2026-10-19T09:30:00Z'), 10);
    await insert(f, Date.parse('2026-10-19T11:30:00Z'), 30);
    await insert(f, Date.parse('2026-10-20T09:30:00Z'), 50);
    const result = await history(f, 'capability=soil_moisture&range=28d');
    expect(result.days.map((d) => [d.date, d.avg, d.partial])).toEqual([
      ['2026-10-19', 10, false],
      ['2026-10-20', 40, false],
    ]);
  });

  it('marks the days at the edges of the range as partial', async () => {
    const f = await fixture('Europe/Berlin');
    await insert(f, NOW - 28 * DAY + 2 * HOUR, 10);
    await insert(f, NOW - 1000, 20);
    const result = await history(f, 'capability=soil_moisture&range=28d');
    expect(result.days.length).toBeGreaterThanOrEqual(2);
    expect(result.days.at(0)?.partial).toBe(true);
    expect(result.days.at(-1)?.partial).toBe(true);
  });

  it('lets a viewer read', async () => {
    const f = await fixture();
    await history(f, 'capability=soil_moisture&range=7d', f.viewer);
  });

  it('answers 404 for unknown devices and foreign households', async () => {
    const f = await fixture();
    const other = await fixture();
    const query = 'capability=soil_moisture&range=7d';
    const unknown = await get(
      `${HOUSEHOLDS}/${f.householdId}/devices/${UNKNOWN_ID}/history?${query}`,
      f.owner,
    ).expect(404);
    expect(errorCode(unknown)).toBe('household.notFound');
    await get(
      `${HOUSEHOLDS}/${f.householdId}/devices/${other.deviceId}/history?${query}`,
      f.owner,
    ).expect(404);
    await get(
      `${HOUSEHOLDS}/${other.householdId}/devices/${other.deviceId}/history?${query}`,
      f.owner,
    ).expect(404);
  });

  it.each([
    'capability=calibration&range=7d',
    'capability=contact&range=7d',
    'capability=nope&range=7d',
    'capability=soil_moisture&range=1y',
    'capability=soil_moisture',
    'range=7d',
  ])('answers 400 for %s', async (query) => {
    const f = await fixture();
    const response = await get(
      `${HOUSEHOLDS}/${f.householdId}/devices/${f.deviceId}/history?${query}`,
      f.owner,
    ).expect(400);
    expect(errorCode(response)).toBe('validation.failed');
  });
});
