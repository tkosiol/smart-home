import {
  Controller,
  Get,
  Global,
  type INestApplication,
  Logger,
  Module,
  Post,
  Req,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { apiErrorSchema } from '@smart/contracts';
import type { Request } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { configureApp } from '../../app.setup.js';
import { ENV, type Env } from '../config/index.js';
import { HttpModule } from './http.module.js';
import { RateLimit } from './throttle.js';

const ORIGIN = 'https://smart.example.org';

@Controller('probe')
class ProbeController {
  @Get('ok')
  ok(): { ok: true } {
    return { ok: true };
  }

  @Post('write')
  write(): { written: true } {
    return { written: true };
  }

  @Get('cookie')
  cookie(@Req() req: Request): { value: unknown } {
    return { value: (req.cookies as Record<string, unknown>)['probe'] };
  }

  @Post('validate')
  validate(): never {
    return z.object({ email: z.email() }).parse({ email: 'leaked-secret-value' }) as never;
  }

  @Get('boom')
  boom(): never {
    throw new Error('internal detail');
  }

  @Post('limited')
  @RateLimit('emailCodeVerifyPerIp')
  limited(): { fine: true } {
    return { fine: true };
  }
}

@Global()
@Module({
  providers: [{ provide: ENV, useValue: { APP_ORIGIN: ORIGIN, TRUSTED_PROXY_HOPS: 1 } as Env }],
  exports: [ENV],
})
class TestEnvModule {}

@Module({ imports: [TestEnvModule, HttpModule], controllers: [ProbeController] })
class TestAppModule {}

describe('HTTP platform', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
    configureApp(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('marks every /api response as no-store, including errors', async () => {
    const ok = await request(app.getHttpServer()).get('/api/probe/ok').expect(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    const missing = await request(app.getHttpServer()).get('/api/probe/missing').expect(404);
    expect(missing.headers['cache-control']).toBe('no-store');
  });

  it('allows GET without an Origin', async () => {
    await request(app.getHttpServer()).get('/api/probe/ok').expect(200);
  });

  it('rejects mutating requests without or with a foreign Origin as 403 auth.badOrigin', async () => {
    for (const origin of [undefined, 'https://evil.example.com']) {
      const req = request(app.getHttpServer()).post('/api/probe/write');
      const response = await (origin ? req.set('Origin', origin) : req).expect(403);
      expect(apiErrorSchema.parse(response.body).code).toBe('auth.badOrigin');
    }
  });

  it('lets mutating requests with the exact Origin through', async () => {
    await request(app.getHttpServer())
      .post('/api/probe/write')
      .set('Origin', ORIGIN)
      .expect(201, { written: true });
  });

  it('parses cookies', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/probe/cookie')
      .set('Cookie', 'probe=abc')
      .expect(200);
    expect(response.body).toEqual({ value: 'abc' });
  });

  it('renders validation errors as 400 validation.failed without the value', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/probe/validate')
      .set('Origin', ORIGIN)
      .expect(400);
    expect(apiErrorSchema.parse(response.body)).toMatchObject({ code: 'validation.failed' });
    expect(JSON.stringify(response.body)).not.toContain('leaked-secret-value');
  });

  it('renders unknown errors as 500 internal without details', async () => {
    const response = await request(app.getHttpServer()).get('/api/probe/boom').expect(500);
    expect(apiErrorSchema.parse(response.body).code).toBe('internal');
    expect(JSON.stringify(response.body)).not.toContain('internal detail');
  });

  it('rate-limits a named limit per IP with 429 auth.rateLimited and retryAfterSeconds', async () => {
    const send = () =>
      request(app.getHttpServer()).post('/api/probe/limited').set('Origin', ORIGIN);
    for (let attempt = 0; attempt < 20; attempt++) await send().expect(201);
    const response = await send().expect(429);
    const body = apiErrorSchema.parse(response.body);
    expect(body.code).toBe('auth.rateLimited');
    expect(body.params?.['retryAfterSeconds']).toBeGreaterThan(0);
  });

  it('does not rate-limit routes that do not opt in', async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      await request(app.getHttpServer()).get('/api/probe/ok').expect(200);
    }
  });

  it('keys rate limits on the address the trusted proxy saw, not on a spoofed header entry', async () => {
    const send = (forwardedFor: string) =>
      request(app.getHttpServer())
        .post('/api/probe/limited')
        .set('Origin', ORIGIN)
        .set('X-Forwarded-For', forwardedFor);
    for (let attempt = 0; attempt < 20; attempt++) {
      await send(`10.0.0.${attempt}, 5.6.7.8`).expect(201);
    }
    const blocked = await send('10.9.9.9, 5.6.7.8').expect(429);
    expect(apiErrorSchema.parse(blocked.body).code).toBe('auth.rateLimited');
    await send('1.2.3.4, 5.6.7.9').expect(201);
  });

  describe('client errors from the body parser', () => {
    it('answers malformed JSON with 400 validation.failed and logs no error', async () => {
      const error = vi.spyOn(Logger.prototype, 'error');
      const response = await request(app.getHttpServer())
        .post('/api/probe/write')
        .set('Origin', ORIGIN)
        .set('Content-Type', 'application/json')
        .send('{"broken":')
        .expect(400);
      expect(apiErrorSchema.parse(response.body).code).toBe('validation.failed');
      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
    });

    it('answers an oversize body with 413 validation.failed and logs no error', async () => {
      const error = vi.spyOn(Logger.prototype, 'error');
      const response = await request(app.getHttpServer())
        .post('/api/probe/write')
        .set('Origin', ORIGIN)
        .send({ filler: 'x'.repeat(200_000) })
        .expect(413);
      expect(apiErrorSchema.parse(response.body).code).toBe('validation.failed');
      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
    });
  });
});
