import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { apiErrorSchema, meSchema, type OverviewLayout } from '@smart/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
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

interface TestUser {
  id: string;
  cookie: string;
}

describe('overview layout per membership', () => {
  let app: INestApplication<App>;
  let connection: DatabaseConnection;
  let counter = 0;
  const originalUrl = inject('testEnv').DATABASE_URL;
  const origin = inject('testEnv').APP_ORIGIN;

  const signedIn = async (): Promise<TestUser> => {
    const email = `layout${(counter += 1)}@example.org`;
    const user = await app.get(UsersRepository).create({ email, displayName: `Layout ${counter}` });
    const { token } = await app.get(SessionService).create(user.id, 'email_code', 'Browser/1');
    return { id: user.id, cookie: `${SESSION_COOKIE}=${token}` };
  };
  const call = (
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    user: TestUser,
  ): request.Test => {
    const base = request(app.getHttpServer());
    const test =
      method === 'get'
        ? base.get(path)
        : method === 'post'
          ? base.post(path)
          : method === 'put'
            ? base.put(path)
            : base.delete(path);
    return test.set('Cookie', user.cookie).set('Origin', origin);
  };
  const layoutPath = (householdId: string): string =>
    `${HOUSEHOLDS}/${householdId}/me/overview-layout`;
  const createHousehold = async (owner: TestUser): Promise<string> => {
    const response = await call('post', HOUSEHOLDS, owner)
      .send({ name: 'Home', timezone: 'Europe/Berlin' })
      .expect(201);
    const id = meSchema.parse(response.body).currentHouseholdId;
    if (!id) throw new Error('no current household');
    return id;
  };
  const addMember = async (householdId: string, user: TestUser, role: string): Promise<void> => {
    await connection.sql`
      insert into memberships (household_id, user_id, role)
      values (${householdId}, ${user.id}, ${role})`;
  };
  const layout = (ids: string[]): OverviewLayout => ({
    blocks: ids.map((id, index) => ({ id, visible: index % 2 === 0 })),
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

  it('answers null before anything is stored', async () => {
    const owner = await signedIn();
    const householdId = await createHousehold(owner);
    const response = await call('get', layoutPath(householdId), owner).expect(200);
    expect(response.body).toBeNull();
  });

  it('saves a layout, reads it back and replaces it', async () => {
    const owner = await signedIn();
    const householdId = await createHousehold(owner);
    const first = layout(['gateway', 'status', 'devices']);
    const saved = await call('put', layoutPath(householdId), owner).send(first).expect(200);
    expect(saved.body).toEqual(first);
    expect((await call('get', layoutPath(householdId), owner).expect(200)).body).toEqual(first);

    const second = layout(['devices']);
    await call('put', layoutPath(householdId), owner).send(second).expect(200);
    expect((await call('get', layoutPath(householdId), owner).expect(200)).body).toEqual(second);
  });

  it('deletes the layout', async () => {
    const owner = await signedIn();
    const householdId = await createHousehold(owner);
    await call('put', layoutPath(householdId), owner)
      .send(layout(['status']))
      .expect(200);
    await call('delete', layoutPath(householdId), owner).expect(204);
    expect((await call('get', layoutPath(householdId), owner).expect(200)).body).toBeNull();
    // Deleting nothing is not an error.
    await call('delete', layoutPath(householdId), owner).expect(204);
  });

  it('keeps the layouts of two members of one household apart, viewers included', async () => {
    const owner = await signedIn();
    const viewer = await signedIn();
    const householdId = await createHousehold(owner);
    await addMember(householdId, viewer, 'viewer');
    const ownerLayout = layout(['status', 'devices']);
    const viewerLayout = layout(['gateway']);
    await call('put', layoutPath(householdId), owner).send(ownerLayout).expect(200);
    await call('put', layoutPath(householdId), viewer).send(viewerLayout).expect(200);
    expect((await call('get', layoutPath(householdId), owner).expect(200)).body).toEqual(
      ownerLayout,
    );
    expect((await call('get', layoutPath(householdId), viewer).expect(200)).body).toEqual(
      viewerLayout,
    );

    await call('delete', layoutPath(householdId), viewer).expect(204);
    expect((await call('get', layoutPath(householdId), viewer).expect(200)).body).toBeNull();
    expect((await call('get', layoutPath(householdId), owner).expect(200)).body).toEqual(
      ownerLayout,
    );
  });

  it('gives one user a layout per household', async () => {
    const user = await signedIn();
    const other = await signedIn();
    const home = await createHousehold(user);
    const cabin = await createHousehold(other);
    await addMember(cabin, user, 'member');
    await call('put', layoutPath(home), user)
      .send(layout(['status']))
      .expect(200);
    await call('put', layoutPath(cabin), user)
      .send(layout(['gateway', 'devices']))
      .expect(200);
    expect((await call('get', layoutPath(home), user).expect(200)).body).toEqual(
      layout(['status']),
    );
    expect((await call('get', layoutPath(cabin), user).expect(200)).body).toEqual(
      layout(['gateway', 'devices']),
    );
  });

  it('rejects more than 20 blocks and malformed bodies with 400 and stores nothing', async () => {
    const owner = await signedIn();
    const householdId = await createHousehold(owner);
    const tooMany = layout(Array.from({ length: 21 }, (_, index) => `block-${index}`));
    for (const body of [tooMany, { blocks: [{ id: 'status' }] }, { blocks: 'status' }, {}]) {
      const response = await call('put', layoutPath(householdId), owner).send(body).expect(400);
      expect(apiErrorSchema.parse(response.body).code).toBe('validation.failed');
    }
    expect((await call('get', layoutPath(householdId), owner).expect(200)).body).toBeNull();
  });

  it('answers a non-member and an unknown household with 404 and changes nothing', async () => {
    const owner = await signedIn();
    const stranger = await signedIn();
    const householdId = await createHousehold(owner);
    const stored = layout(['status']);
    await call('put', layoutPath(householdId), owner).send(stored).expect(200);

    for (const [method, path] of [
      ['get', layoutPath(householdId)],
      ['put', layoutPath(householdId)],
      ['delete', layoutPath(householdId)],
      ['get', layoutPath(UNKNOWN_ID)],
    ] as const) {
      const response = await call(method, path, stranger)
        .send(layout(['gateway']))
        .expect(404);
      expect(apiErrorSchema.parse(response.body).code).toBe('household.notFound');
    }
    expect((await call('get', layoutPath(householdId), owner).expect(200)).body).toEqual(stored);
  });

  it('answers a request without a session with 401', async () => {
    const owner = await signedIn();
    const householdId = await createHousehold(owner);
    await request(app.getHttpServer())
      .get(layoutPath(householdId))
      .set('Origin', origin)
      .expect(401);
  });
});
