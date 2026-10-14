import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { apiErrorSchema, householdSummarySchema, meSchema, type Me } from '@smart/contracts';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { memberships } from '../src/core/households/index.js';
import { SESSION_COOKIE, SessionService, UsersRepository } from '../src/core/identity/index.js';
import {
  DATABASE,
  type DatabaseConnection,
  runMigrations,
} from '../src/platform/database/index.js';
import { MQTT_CONNECTION, type MqttConnection } from '../src/platform/mqtt/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';

const ME = '/api/v1/me';
const HOUSEHOLDS = '/api/v1/households';
const BERLIN = { name: 'Home', timezone: 'Europe/Berlin' };

describe('households and the household guard', () => {
  let app: INestApplication<App>;
  let connection: DatabaseConnection;
  let counter = 0;
  const originalUrl = inject('testEnv').DATABASE_URL;
  const origin = inject('testEnv').APP_ORIGIN;

  const signedIn = async (): Promise<{ id: string; cookie: string }> => {
    const email = `house${(counter += 1)}@example.org`;
    const user = await app.get(UsersRepository).create({ email, displayName: `House ${counter}` });
    const { token } = await app.get(SessionService).create(user.id, 'email_code', 'Browser/1');
    return { id: user.id, cookie: `${SESSION_COOKIE}=${token}` };
  };
  const send = (
    method: 'post' | 'patch' | 'put',
    path: string,
    cookie: string,
    body: unknown,
  ): request.Test => {
    const server = app.getHttpServer();
    const call =
      method === 'post'
        ? request(server).post(path)
        : method === 'patch'
          ? request(server).patch(path)
          : request(server).put(path);
    return call
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body as object);
  };
  const getMe = async (cookie: string): Promise<Me> => {
    const response = await request(app.getHttpServer()).get(ME).set('Cookie', cookie).expect(200);
    return meSchema.parse(response.body);
  };
  const createHousehold = async (cookie: string, body: object = BERLIN): Promise<string> => {
    const response = await send('post', HOUSEHOLDS, cookie, body).expect(201);
    const me = meSchema.parse(response.body);
    if (!me.currentHouseholdId) throw new Error('no current household');
    return me.currentHouseholdId;
  };
  /** Adds a membership directly: invitations come with a later task. */
  const addMember = async (householdId: string, userId: string, role: string): Promise<void> => {
    await connection.sql`
      insert into memberships (household_id, user_id, role) values (${householdId}, ${userId}, ${role})`;
  };
  const shape = (response: request.Response): { status: number; body: unknown } => ({
    status: response.status,
    body: Object.fromEntries(
      Object.entries(response.body as Record<string, unknown>).filter(([key]) => key !== 'traceId'),
    ),
  });

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

  describe('GET /me', () => {
    it('lists no household for a new user', async () => {
      const user = await signedIn();
      expect(await getMe(user.cookie)).toMatchObject({ households: [], currentHouseholdId: null });
    });
  });

  describe('POST /households', () => {
    it('creates the household with the caller as owner and makes it the current one', async () => {
      const user = await signedIn();
      const response = await send('post', HOUSEHOLDS, user.cookie, {
        name: ' Home ',
        timezone: 'Europe/Berlin',
      }).expect(201);
      const me = meSchema.parse(response.body);
      expect(me.households).toEqual([
        { id: me.currentHouseholdId, name: 'Home', timezone: 'Europe/Berlin', role: 'owner' },
      ]);
      expect(me.currentHouseholdId).toBe(me.households[0]?.id);
      expect(await getMe(user.cookie)).toEqual(me);
    });

    it('makes each new household the current one and lists them by name', async () => {
      const user = await signedIn();
      const zebra = await createHousehold(user.cookie, { name: 'Zebra', timezone: 'UTC' });
      const apple = await createHousehold(user.cookie, { name: 'Apple', timezone: 'UTC' });
      const me = await getMe(user.cookie);
      expect(me.households.map((household) => household.name)).toEqual(['Apple', 'Zebra']);
      expect(me.currentHouseholdId).toBe(apple);
      expect(me.currentHouseholdId).not.toBe(zebra);
    });

    it.each([
      ['a blank name', { name: '   ', timezone: 'Europe/Berlin' }],
      ['an unknown time zone', { name: 'Home', timezone: 'Mars/Olympus' }],
      ['a missing time zone', { name: 'Home' }],
    ])('rejects %s with 400 validation.failed and creates nothing', async (_name, body) => {
      const user = await signedIn();
      const response = await send('post', HOUSEHOLDS, user.cookie, body).expect(400);
      expect(apiErrorSchema.parse(response.body).code).toBe('validation.failed');
      expect((await getMe(user.cookie)).households).toEqual([]);
    });

    it('rejects a request without Origin with 403 auth.badOrigin', async () => {
      const user = await signedIn();
      const response = await request(app.getHttpServer())
        .post(HOUSEHOLDS)
        .set('Cookie', user.cookie)
        .send(BERLIN)
        .expect(403);
      expect(apiErrorSchema.parse(response.body).code).toBe('auth.badOrigin');
    });

    it('answers without a session with 401', async () => {
      await request(app.getHttpServer())
        .post(HOUSEHOLDS)
        .set('Origin', origin)
        .send(BERLIN)
        .expect(401);
    });
  });

  describe('PATCH /households/:householdId', () => {
    it('lets the owner change name and time zone', async () => {
      const owner = await signedIn();
      const id = await createHousehold(owner.cookie);
      const response = await send('patch', `${HOUSEHOLDS}/${id}`, owner.cookie, {
        name: 'Cabin',
        timezone: 'Pacific/Chatham',
      }).expect(200);
      expect(householdSummarySchema.parse(response.body)).toEqual({
        id,
        name: 'Cabin',
        timezone: 'Pacific/Chatham',
        role: 'owner',
      });
      expect((await getMe(owner.cookie)).households).toEqual([
        { id, name: 'Cabin', timezone: 'Pacific/Chatham', role: 'owner' },
      ]);
    });

    it('changes only what is sent', async () => {
      const owner = await signedIn();
      const id = await createHousehold(owner.cookie);
      const response = await send('patch', `${HOUSEHOLDS}/${id}`, owner.cookie, {
        name: 'Cabin',
      }).expect(200);
      expect(response.body).toMatchObject({ name: 'Cabin', timezone: 'Europe/Berlin' });
      await send('patch', `${HOUSEHOLDS}/${id}`, owner.cookie, {}).expect(200);
    });

    it('rejects an invalid time zone with 400 validation.failed', async () => {
      const owner = await signedIn();
      const id = await createHousehold(owner.cookie);
      const response = await send('patch', `${HOUSEHOLDS}/${id}`, owner.cookie, {
        timezone: 'Mars/Olympus',
      }).expect(400);
      expect(apiErrorSchema.parse(response.body).code).toBe('validation.failed');
    });

    it('answers a member with 403 household.forbidden and changes nothing', async () => {
      const owner = await signedIn();
      const member = await signedIn();
      const id = await createHousehold(owner.cookie);
      await addMember(id, member.id, 'member');
      const response = await send('patch', `${HOUSEHOLDS}/${id}`, member.cookie, {
        name: 'Hijacked',
      }).expect(403);
      expect(apiErrorSchema.parse(response.body).code).toBe('household.forbidden');
      expect((await getMe(owner.cookie)).households[0]?.name).toBe('Home');
    });

    it('answers a viewer with 403 household.forbidden', async () => {
      const owner = await signedIn();
      const viewer = await signedIn();
      const id = await createHousehold(owner.cookie);
      await addMember(id, viewer.id, 'viewer');
      await send('patch', `${HOUSEHOLDS}/${id}`, viewer.cookie, { name: 'x' }).expect(403);
    });

    it('answers non-member, malformed and unknown ids alike with 404 household.notFound', async () => {
      const owner = await signedIn();
      const stranger = await signedIn();
      const id = await createHousehold(owner.cookie);
      const body = { name: 'Hijacked' };
      const foreign = await send('patch', `${HOUSEHOLDS}/${id}`, stranger.cookie, body);
      const malformed = await send('patch', `${HOUSEHOLDS}/not-a-uuid`, stranger.cookie, body);
      const unknown = await send(
        'patch',
        `${HOUSEHOLDS}/3b241101-e2bb-4255-8caf-4136c566a962`,
        stranger.cookie,
        body,
      );
      expect(foreign.status).toBe(404);
      expect(apiErrorSchema.parse(foreign.body).code).toBe('household.notFound');
      expect(shape(malformed)).toEqual(shape(foreign));
      expect(shape(unknown)).toEqual(shape(foreign));
      expect((await getMe(owner.cookie)).households[0]?.name).toBe('Home');
    });

    it('answers without a session with 401', async () => {
      await request(app.getHttpServer())
        .patch(`${HOUSEHOLDS}/3b241101-e2bb-4255-8caf-4136c566a962`)
        .set('Origin', origin)
        .send({ name: 'x' })
        .expect(401);
    });
  });

  describe('PUT /me', () => {
    it('selects one of the own households as the current one', async () => {
      const user = await signedIn();
      const first = await createHousehold(user.cookie, { name: 'First', timezone: 'UTC' });
      await createHousehold(user.cookie, { name: 'Second', timezone: 'UTC' });
      const response = await send('put', ME, user.cookie, { householdId: first }).expect(200);
      expect(meSchema.parse(response.body).currentHouseholdId).toBe(first);
      expect((await getMe(user.cookie)).currentHouseholdId).toBe(first);
    });

    it('answers a foreign, malformed or unknown household with 404 and keeps the selection', async () => {
      const owner = await signedIn();
      const stranger = await signedIn();
      const foreign = await createHousehold(owner.cookie);
      const own = await createHousehold(stranger.cookie, { name: 'Mine', timezone: 'UTC' });
      for (const householdId of [foreign, 'not-a-uuid', '3b241101-e2bb-4255-8caf-4136c566a962']) {
        const response = await send('put', ME, stranger.cookie, { householdId }).expect(404);
        expect(apiErrorSchema.parse(response.body).code).toBe('household.notFound');
      }
      expect((await getMe(stranger.cookie)).currentHouseholdId).toBe(own);
    });

    it('rejects a body without householdId with 400 validation.failed', async () => {
      const user = await signedIn();
      const response = await send('put', ME, user.cookie, {}).expect(400);
      expect(apiErrorSchema.parse(response.body).code).toBe('validation.failed');
    });
  });

  describe('current household fallback', () => {
    it('falls back to the oldest membership when the last household was left', async () => {
      const user = await signedIn();
      const oldest = await createHousehold(user.cookie, { name: 'Oldest', timezone: 'UTC' });
      const middle = await createHousehold(user.cookie, { name: 'Middle', timezone: 'UTC' });
      const last = await createHousehold(user.cookie, { name: 'Last', timezone: 'UTC' });
      expect((await getMe(user.cookie)).currentHouseholdId).toBe(last);
      await app
        .get<DatabaseConnection>(DATABASE)
        .db.delete(memberships)
        .where(and(eq(memberships.householdId, last), eq(memberships.userId, user.id)));
      const me = await getMe(user.cookie);
      expect(me.households.map((household) => household.id).sort()).toEqual(
        [middle, oldest].sort(),
      );
      expect(me.currentHouseholdId).toBe(oldest);
    });

    it('is null for a user whose memberships are all gone', async () => {
      const user = await signedIn();
      const id = await createHousehold(user.cookie);
      await connection.sql`delete from memberships where household_id = ${id}`;
      expect(await getMe(user.cookie)).toMatchObject({ households: [], currentHouseholdId: null });
    });

    it('forgets the last household when it is deleted (on delete set null)', async () => {
      const user = await signedIn();
      const id = await createHousehold(user.cookie);
      await connection.sql`delete from households where id = ${id}`;
      const [row] = await connection.sql`select last_household_id from users where id = ${user.id}`;
      expect(row?.last_household_id).toBeNull();
    });
  });
});
