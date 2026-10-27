import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { attentionListSchema, meSchema, type AttentionItem } from '@smart/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import {
  ATTENTION_CHANGED,
  AttentionEvents,
  AttentionService,
  type AttentionChanged,
} from '../src/core/attention/index.js';
import { SESSION_COOKIE, SessionService, UsersRepository } from '../src/core/identity/index.js';
import {
  DATABASE,
  type DatabaseConnection,
  runMigrations,
} from '../src/platform/database/index.js';
import { MQTT_CONNECTION, type MqttConnection } from '../src/platform/mqtt/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';

const HOUSEHOLDS = '/api/v1/households';

interface Person {
  id: string;
  cookie: string;
}
interface Household {
  id: string;
  owner: Person;
  viewer: Person;
  gatewayId: string;
}

describe('attention items of a household', () => {
  let app: INestApplication<App>;
  let connection: DatabaseConnection;
  let attention: AttentionService;
  let counter = 0;
  const originalUrl = inject('testEnv').DATABASE_URL;
  const origin = inject('testEnv').APP_ORIGIN;

  const signedIn = async (admin = false): Promise<Person> => {
    const email = `attention${(counter += 1)}@example.org`;
    const user = await app
      .get(UsersRepository)
      .create({ email, displayName: `Attention ${counter}` });
    if (admin)
      await connection.sql`update users set is_platform_admin = true where id = ${user.id}`;
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
  const itemsOf = async (household: Household, who: Person): Promise<AttentionItem[]> => {
    const response = await get(`${HOUSEHOLDS}/${household.id}/attention`, who).expect(200);
    return attentionListSchema.parse(response.body).items;
  };

  /** A household with a gateway that has been online for an hour. */
  const household = async (): Promise<Household> => {
    const owner = await signedIn();
    const viewer = await signedIn();
    const created = await post(HOUSEHOLDS, owner, { name: 'Home', timezone: 'Europe/Berlin' });
    const id = meSchema.parse(created.body).currentHouseholdId;
    if (!id) throw new Error('no current household');
    await connection.sql`
      insert into memberships (household_id, user_id, role) values (${id}, ${viewer.id}, 'viewer')`;
    const gatewayId = `gw-${randomBytes(4).toString('hex')}`;
    await connection.sql`
      insert into gateways (id, household_id, name, topic_prefix, cert_fingerprint, cert_expires_at,
        bridge_status, z2m_status, status_changed_at, last_message_at)
      values (${gatewayId}, ${id}, 'Pi', ${`gw/${gatewayId}/z2m`}, 'fingerprint',
        now() + interval '1 year', 'online', 'online', now() - interval '1 hour', now())`;
    return { id, owner, viewer, gatewayId };
  };

  /** A plant sensor of the simulator's kind, assigned to a device. */
  const addPlant = async (
    who: Household,
    name: string,
    state: object,
    assign = true,
  ): Promise<string> => {
    const [row] = await connection.sql<{ id: string }[]>`
      insert into hardware (gateway_id, ieee_address, friendly_name, vendor, model, availability,
        last_state, first_seen_at, last_seen_at)
      values (${who.gatewayId}, ${`0x${randomBytes(8).toString('hex')}`}, ${name}, 'AOYAN',
        'AY-303Z', 'online', ${JSON.stringify(state)}::jsonb, now(), now())
      returning id`;
    if (!row) throw new Error('no hardware');
    await connection.sql`
      insert into capabilities (hardware_id, key, kind, unit, readable, writable, is_setting)
      values (${row.id}, 'soil_moisture', 'numeric', '%', true, false, false),
        (${row.id}, 'battery', 'numeric', '%', true, false, false),
        (${row.id}, 'dry', 'binary', null, true, false, false)`;
    if (!assign) return row.id;
    const response = await post(`${HOUSEHOLDS}/${who.id}/devices`, who.owner, {
      hardwareId: row.id,
      name,
    }).expect(201);
    return (response.body as { id: string }).id;
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
    attention = app.get(AttentionService);
  });

  afterAll(async () => {
    await app.close();
    process.env.DATABASE_URL = originalUrl;
  });

  it('is empty for a healthy household', async () => {
    const home = await household();
    await addPlant(home, 'Ficus', { soil_moisture: 60, battery: 90, dry: false });
    await attention.recomputeHousehold(home.id);
    expect(await itemsOf(home, home.owner)).toEqual([]);
  });

  it('answers with exactly one critical item for an offline gateway with 12 devices', async () => {
    const home = await household();
    for (let index = 1; index <= 12; index += 1) {
      await addPlant(home, `Pflanze ${index}`, { soil_moisture: 5, battery: 3, dry: true });
    }
    await attention.recomputeHousehold(home.id);
    expect(await itemsOf(home, home.owner)).toHaveLength(24);

    await connection.sql`
      update gateways set bridge_status = 'offline', status_changed_at = now() - interval '10 minutes'
      where id = ${home.gatewayId}`;
    await attention.recomputeHousehold(home.id);

    const items = await itemsOf(home, home.owner);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: `gateway_offline:${home.gatewayId}`,
      kind: 'gateway_offline',
      severity: 'critical',
      gatewayId: home.gatewayId,
      name: 'Pi',
      params: { affectedDevices: 12 },
    });
    expect(await itemsOf(home, home.viewer)).toEqual(items);
  });

  it('shows warnings to a viewer and new hardware to the owner only', async () => {
    const home = await household();
    await addPlant(home, 'Ficus', { soil_moisture: 10, battery: 90 });
    await addPlant(home, 'Neu', { soil_moisture: 50 }, false);
    await attention.recomputeHousehold(home.id);

    const owner = await itemsOf(home, home.owner);
    expect(owner.map((item) => item.kind).sort()).toEqual(['hardware_new', 'soil_dry']);
    const viewer = await itemsOf(home, home.viewer);
    expect(viewer.map((item) => item.kind)).toEqual(['soil_dry']);
    expect(viewer[0]).toMatchObject({ severity: 'warning', value: 10, unit: '%', name: 'Ficus' });
  });

  it('shows an expiring certificate to the owner and a platform admin, not to a viewer', async () => {
    const home = await household();
    await connection.sql`
      update gateways set cert_expires_at = now() + interval '10 days' where id = ${home.gatewayId}`;
    const admin = await signedIn(true);
    await connection.sql`
      insert into memberships (household_id, user_id, role) values (${home.id}, ${admin.id}, 'viewer')`;
    await attention.recomputeHousehold(home.id);

    expect((await itemsOf(home, home.owner)).map((item) => item.kind)).toEqual(['cert_expiring']);
    expect((await itemsOf(home, admin)).map((item) => item.kind)).toEqual(['cert_expiring']);
    expect(await itemsOf(home, home.viewer)).toEqual([]);
  });

  it('applies a changed threshold at once', async () => {
    const home = await household();
    const deviceId = await addPlant(home, 'Ficus', { soil_moisture: 20 });
    await attention.recomputeHousehold(home.id);
    expect((await itemsOf(home, home.owner)).map((item) => item.id)).toEqual([
      `soil_dry:${deviceId}`,
    ]);

    await patch(`${HOUSEHOLDS}/${home.id}/devices/${deviceId}`, home.owner, {
      thresholds: { soilMoistureMin: 10 },
    }).expect(200);
    await attention.idle();
    expect(await itemsOf(home, home.owner)).toEqual([]);
  });

  it('announces attention.changed only when the list differs', async () => {
    const home = await household();
    const changed: AttentionChanged[] = [];
    const listener = (event: AttentionChanged): void => void changed.push(event);
    app.get(AttentionEvents).on(ATTENTION_CHANGED, listener);
    const deviceId = await addPlant(home, 'Ficus', { soil_moisture: 20 });
    await attention.recomputeHousehold(home.id);
    expect(changed.filter((event) => event.householdId === home.id)).toHaveLength(1);
    await attention.recomputeHousehold(home.id);
    expect(changed.filter((event) => event.householdId === home.id)).toHaveLength(1);
    await patch(`${HOUSEHOLDS}/${home.id}/devices/${deviceId}`, home.owner, {
      thresholds: { soilMoistureMin: 10 },
    }).expect(200);
    await attention.idle();
    expect(changed.filter((event) => event.householdId === home.id)).toHaveLength(2);
    app.get(AttentionEvents).off(ATTENTION_CHANGED, listener);
  });

  it('hides a household from people who are not its members', async () => {
    const home = await household();
    const stranger = await signedIn();
    await get(`${HOUSEHOLDS}/${home.id}/attention`, stranger).expect(404);
    await request(app.getHttpServer()).get(`${HOUSEHOLDS}/${home.id}/attention`).expect(401);
  });
});
