import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { healthLiveResponseSchema } from '@smart/contracts';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

describe('GET /api/health/live', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the process as live', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/live').expect(200);
    expect(healthLiveResponseSchema.parse(response.body)).toEqual({ status: 'ok' });
  });

  it('serves nothing outside the /api prefix', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(404);
  });
});
