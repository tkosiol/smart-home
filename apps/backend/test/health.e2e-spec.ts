import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { healthLiveResponseSchema, healthReadyResponseSchema } from '@smart/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { MQTT_CONNECTION, type MqttConnection } from '../src/platform/mqtt/index.js';

async function startApp(): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  await app.get<MqttConnection>(MQTT_CONNECTION).waitUntilConnected(5000);
  return app;
}

describe('health endpoints with all dependencies up', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health/live reports the process as live and sets a trace id', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/live').expect(200);
    expect(healthLiveResponseSchema.parse(response.body)).toEqual({ status: 'ok' });
    expect(response.headers['x-trace-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('GET /api/health/ready reports database and broker up', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/ready').expect(200);
    expect(healthReadyResponseSchema.parse(response.body)).toEqual({
      status: 'ok',
      checks: { database: 'up', broker: 'up' },
    });
  });

  it('serves nothing outside the /api prefix', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(404);
  });
});

describe('health endpoints with the database down', () => {
  let app: INestApplication<App>;
  const original = inject('testEnv').DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgres://smart:x@127.0.0.1:1/smart';
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
    process.env.DATABASE_URL = original;
  });

  it('GET /api/health/ready answers 503 and names the failing dependency', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/ready').expect(503);
    expect(healthReadyResponseSchema.parse(response.body)).toEqual({
      status: 'unavailable',
      checks: { database: 'down', broker: 'up' },
    });
  });

  it('GET /api/health/live stays 200 (liveness does not depend on the database)', async () => {
    await request(app.getHttpServer()).get('/api/health/live').expect(200);
  });
});
