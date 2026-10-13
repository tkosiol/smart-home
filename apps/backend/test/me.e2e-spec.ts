import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { apiErrorSchema, meSchema } from '@smart/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { SESSION_COOKIE, SessionService, UsersRepository } from '../src/core/identity/index.js';
import { runMigrations } from '../src/platform/database/index.js';
import { MQTT_CONNECTION, type MqttConnection } from '../src/platform/mqtt/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';

const ME = '/api/v1/me';
const PREFERENCES = `${ME}/preferences`;

describe('me and preferences', () => {
  let app: INestApplication<App>;
  let users: UsersRepository;
  let counter = 0;
  const originalUrl = inject('testEnv').DATABASE_URL;
  const origin = inject('testEnv').APP_ORIGIN;

  const signedIn = async (): Promise<{ id: string; email: string; cookie: string }> => {
    const email = `me${(counter += 1)}@example.org`;
    const user = await users.create({ email, displayName: `Me ${counter}` });
    const { token } = await app.get(SessionService).create(user.id, 'email_code', 'Browser/1');
    return { id: user.id, email, cookie: `${SESSION_COOKIE}=${token}` };
  };
  const put = (cookie: string, body: unknown, withOrigin = true): request.Test => {
    const call = request(app.getHttpServer()).put(PREFERENCES).set('Cookie', cookie);
    if (withOrigin) call.set('Origin', origin);
    return call.send(body as object);
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
    users = app.get(UsersRepository);
  });

  afterAll(async () => {
    await app.close();
    process.env.DATABASE_URL = originalUrl;
  });

  describe('GET /me', () => {
    it('answers without a session with 401 auth.required', async () => {
      const response = await request(app.getHttpServer()).get(ME).expect(401);
      expect(apiErrorSchema.parse(response.body).code).toBe('auth.required');
    });

    it('returns the signed-in user in the shape of the contract', async () => {
      const user = await signedIn();
      const response = await request(app.getHttpServer())
        .get(ME)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(meSchema.parse(response.body)).toEqual({
        id: user.id,
        email: user.email,
        displayName: `Me ${counter}`,
        locale: 'de',
        appearance: { mode: 'system', contrast: 'system' },
        isPlatformAdmin: false,
      });
      expect(response.headers['cache-control']).toBe('no-store');
    });
  });

  describe('PUT /me/preferences', () => {
    it('stores language and appearance and returns the updated me', async () => {
      const user = await signedIn();
      const appearance = { mode: 'dark', contrast: 'high' };
      const response = await put(user.cookie, { locale: 'en', appearance }).expect(200);
      expect(meSchema.parse(response.body)).toMatchObject({
        id: user.id,
        locale: 'en',
        appearance,
      });
      const again = await request(app.getHttpServer()).get(ME).set('Cookie', user.cookie);
      expect(again.body).toMatchObject({ locale: 'en', appearance });
      expect((await users.findById(user.id))?.locale).toBe('en');
    });

    it('changes only what is sent', async () => {
      const user = await signedIn();
      await put(user.cookie, { appearance: { mode: 'light', contrast: 'medium' } }).expect(200);
      const response = await put(user.cookie, { locale: 'en' }).expect(200);
      expect(response.body).toMatchObject({
        locale: 'en',
        appearance: { mode: 'light', contrast: 'medium' },
      });
    });

    it('ignores fields that are not preferences (no mass assignment)', async () => {
      const user = await signedIn();
      const response = await put(user.cookie, {
        isPlatformAdmin: true,
        email: 'taken@example.org',
        id: '00000000-0000-4000-8000-000000000000',
        locale: 'en',
      }).expect(200);
      expect(response.body).toMatchObject({
        id: user.id,
        email: user.email,
        locale: 'en',
        isPlatformAdmin: false,
      });
      expect(await users.findById(user.id)).toMatchObject({
        id: user.id,
        email: user.email,
        isPlatformAdmin: false,
      });
    });

    it('rejects an invalid mode with 400 validation.failed and stores nothing', async () => {
      const user = await signedIn();
      const response = await put(user.cookie, {
        appearance: { mode: 'sepia', contrast: 'system' },
      }).expect(400);
      expect(apiErrorSchema.parse(response.body).code).toBe('validation.failed');
      expect((await users.findById(user.id))?.appearance).toEqual({
        mode: 'system',
        contrast: 'system',
      });
    });

    it('rejects an unsupported language with 400 validation.failed', async () => {
      const user = await signedIn();
      const response = await put(user.cookie, { locale: 'fr' }).expect(400);
      expect(apiErrorSchema.parse(response.body).code).toBe('validation.failed');
    });

    it('rejects a request without Origin with 403 auth.badOrigin', async () => {
      const user = await signedIn();
      const response = await put(user.cookie, { locale: 'en' }, false).expect(403);
      expect(apiErrorSchema.parse(response.body).code).toBe('auth.badOrigin');
      expect((await users.findById(user.id))?.locale).toBe('de');
    });

    it('answers without a session with 401', async () => {
      await request(app.getHttpServer())
        .put(PREFERENCES)
        .set('Origin', origin)
        .send({ locale: 'en' })
        .expect(401);
    });
  });
});
