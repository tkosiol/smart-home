import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { apiErrorSchema, DEFAULT_INSTANCE_APPEARANCE } from '@smart/contracts';
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

const APPEARANCE = '/api/v1/instance/appearance';
const PLUM = {
  colors: { seed: '#6750a4', variant: 'vibrant', colorMatch: true, coreOverrides: {} },
  shape: 'weich',
  font: 'roboto-flex',
};

describe('instance appearance', () => {
  let app: INestApplication<App>;
  let connection: DatabaseConnection;
  let counter = 0;
  const originalUrl = inject('testEnv').DATABASE_URL;
  const origin = inject('testEnv').APP_ORIGIN;

  const signedIn = async (isPlatformAdmin: boolean): Promise<string> => {
    const email = `appearance${(counter += 1)}@example.org`;
    const user = await app
      .get(UsersRepository)
      .create({ email, displayName: `Appearance ${counter}`, isPlatformAdmin });
    const { token } = await app.get(SessionService).create(user.id, 'email_code', 'Browser/1');
    return `${SESSION_COOKIE}=${token}`;
  };
  const put = (body: unknown, cookie?: string): request.Test => {
    const call = request(app.getHttpServer()).put(APPEARANCE).set('Origin', origin);
    return (cookie ? call.set('Cookie', cookie) : call).send(body as object);
  };

  beforeAll(async () => {
    const url = await createFreshDatabase(originalUrl);
    await runMigrations(url);
    process.env.DATABASE_URL = url;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    await app.get<MqttConnection>(MQTT_CONNECTION).waitUntilConnected(5000);
    connection = app.get<DatabaseConnection>(DATABASE);
  });

  afterAll(async () => {
    await app.close();
    process.env.DATABASE_URL = originalUrl;
  });

  it('answers null without a session while nothing is stored', async () => {
    const response = await request(app.getHttpServer()).get(APPEARANCE).expect(200);
    expect(response.body).toEqual({ appearance: null });
  });

  it('lets a platform admin store the appearance and serves it without a session', async () => {
    const admin = await signedIn(true);
    const stored = await put({ appearance: PLUM }, admin).expect(200);
    expect(stored.body).toEqual({ appearance: PLUM });
    const response = await request(app.getHttpServer()).get(APPEARANCE).expect(200);
    expect(response.body).toEqual({ appearance: PLUM });
    // A second write replaces the single row.
    await put({ appearance: DEFAULT_INSTANCE_APPEARANCE }, admin).expect(200);
    const rows = await connection.sql`select id, updated_by from instance_settings`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['id']).toBe(1);
    expect(rows[0]?.['updated_by']).not.toBeNull();
  });

  it('resets to null with { appearance: null }', async () => {
    const admin = await signedIn(true);
    await put({ appearance: PLUM }, admin).expect(200);
    const reset = await put({ appearance: null }, admin).expect(200);
    expect(reset.body).toEqual({ appearance: null });
    const response = await request(app.getHttpServer()).get(APPEARANCE).expect(200);
    expect(response.body).toEqual({ appearance: null });
  });

  it('refuses a normal user with 403 auth.forbidden and stores nothing', async () => {
    const admin = await signedIn(true);
    await put({ appearance: null }, admin).expect(200);
    const member = await signedIn(false);
    const response = await put({ appearance: PLUM }, member).expect(403);
    expect(apiErrorSchema.parse(response.body).code).toBe('auth.forbidden');
    const read = await request(app.getHttpServer()).get(APPEARANCE).expect(200);
    expect(read.body).toEqual({ appearance: null });
  });

  it('answers 401 without a session', async () => {
    await put({ appearance: PLUM }).expect(401);
  });

  it('answers 400 for an invalid appearance', async () => {
    const admin = await signedIn(true);
    await put({ appearance: { ...PLUM, shape: 'zigzag' } }, admin).expect(400);
    await put({ appearance: { ...PLUM, colors: { ...PLUM.colors, seed: 'red' } } }, admin).expect(
      400,
    );
    await put({}, admin).expect(400);
  });

  it('answers null when the stored value no longer passes the schema', async () => {
    const admin = await signedIn(true);
    await put({ appearance: PLUM }, admin).expect(200);
    await connection.sql`update instance_settings set appearance = '{"shape":"zigzag"}'::jsonb where id = 1`;
    const response = await request(app.getHttpServer()).get(APPEARANCE).expect(200);
    expect(response.body).toEqual({ appearance: null });
  });
});
