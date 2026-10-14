import { Controller, Get, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import {
  CLOCK,
  CleanupJob,
  CurrentUser,
  SESSION_COOKIE,
  SessionService,
  UsersRepository,
  emailLoginCodes,
  sessions,
  type AuthenticatedUser,
} from '../src/core/identity/index.js';
import {
  DATABASE,
  type DatabaseConnection,
  runMigrations,
} from '../src/platform/database/index.js';
import { Public } from '../src/platform/http/index.js';
import { MQTT_CONNECTION, type MqttConnection } from '../src/platform/mqtt/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';

const DAY = 86_400_000;
const START = new Date('2026-03-01T10:00:00Z');

@Controller('probe')
class ProbeController {
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  @Post('write')
  write(): { ok: true } {
    return { ok: true };
  }

  @Public()
  @Get('open')
  open(): { ok: true } {
    return { ok: true };
  }
}

describe('identity: users and sessions', () => {
  let app: INestApplication<App>;
  let now = START;
  let connection: DatabaseConnection;
  let service: SessionService;
  let userId: string;
  const originalUrl = inject('testEnv').DATABASE_URL;
  const origin = inject('testEnv').APP_ORIGIN;

  const advance = (ms: number): void => {
    now = new Date(now.getTime() + ms);
  };
  const cookie = (token: string): string => `${SESSION_COOKIE}=${token}`;
  const sessionRow = async (id: string) => {
    const [row] = await connection.db.select().from(sessions).where(eq(sessions.id, id));
    if (!row) throw new Error('session row missing');
    return row;
  };

  beforeAll(async () => {
    const url = await createFreshDatabase(originalUrl);
    await runMigrations(url);
    process.env.DATABASE_URL = url;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    })
      .overrideProvider(CLOCK)
      .useValue(() => now)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    configureApp(app);
    await app.init();
    await app.get<MqttConnection>(MQTT_CONNECTION).waitUntilConnected(5000);
    connection = app.get<DatabaseConnection>(DATABASE);
    service = app.get(SessionService);
    const user = await app.get(UsersRepository).create({
      email: 'anna@example.org',
      displayName: 'Anna',
    });
    userId = user.id;
  });

  afterAll(async () => {
    await app.close();
    process.env.DATABASE_URL = originalUrl;
  });

  beforeEach(() => {
    now = START;
  });

  it('stores users with defaults and a hash instead of the token', async () => {
    const user = await app.get(UsersRepository).findByEmail('anna@example.org');
    expect(user).toMatchObject({
      locale: 'de',
      appearance: { mode: 'system', contrast: 'system' },
      isPlatformAdmin: false,
    });
    const { token } = await service.create(userId, 'email_code', 'Browser/1');
    const rows = await connection.sql`select token_hash from sessions`;
    const hashes = rows.map((row) => String(row.token_hash));
    expect(hashes).not.toContain(token);
    expect(hashes.every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
  });

  it('accepts a valid session and serves the protected route', async () => {
    const { token } = await service.create(userId, 'email_code', 'Browser/1');
    const response = await request(app.getHttpServer())
      .get('/api/probe/me')
      .set('Cookie', cookie(token))
      .expect(200);
    expect(response.body).toMatchObject({ id: userId });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('rejects an expired session', async () => {
    const { token } = await service.create(userId, 'email_code', 'Browser/1');
    advance(30 * DAY);
    expect(await service.validate(token)).toBeNull();
    await request(app.getHttpServer())
      .get('/api/probe/me')
      .set('Cookie', cookie(token))
      .expect(401);
  });

  it('rejects a revoked session', async () => {
    const { token } = await service.create(userId, 'email_code', 'Browser/1');
    const valid = await service.validate(token);
    if (!valid) throw new Error('expected a valid session');
    await service.revoke(valid.sessionId);
    expect(await service.validate(token)).toBeNull();
    await request(app.getHttpServer())
      .get('/api/probe/me')
      .set('Cookie', cookie(token))
      .expect(401);
  });

  it('rejects a tampered or unknown cookie', async () => {
    const { token } = await service.create(userId, 'email_code', 'Browser/1');
    expect(await service.validate(`${token}x`)).toBeNull();
    expect(await service.validate(token.slice(1))).toBeNull();
    expect(await service.validate('')).toBeNull();
    await request(app.getHttpServer())
      .get('/api/probe/me')
      .set('Cookie', cookie(`${token}x`))
      .expect(401);
  });

  it('ends a session 180 days after creation even with continuous activity', async () => {
    const { token, expiresAt } = await service.create(userId, 'email_code', 'Browser/1');
    const absolute = START.getTime() + 180 * DAY;
    expect(expiresAt.getTime()).toBe(START.getTime() + 30 * DAY);

    for (let day = 25; day <= 150; day += 25) {
      now = new Date(START.getTime() + day * DAY);
      expect(await service.validate(token)).toMatchObject({ refreshed: true });
    }
    now = new Date(START.getTime() + 175 * DAY);
    const nearEnd = await service.validate(token);
    expect(nearEnd).toMatchObject({ refreshed: true });
    expect(nearEnd?.expiresAt.getTime()).toBe(absolute);

    now = new Date(absolute);
    expect(await service.validate(token)).toBeNull();
  });

  it('extends the session only after more than 60 seconds', async () => {
    const { token } = await service.create(userId, 'email_code', 'Browser/1');
    const first = await service.validate(token);
    if (!first) throw new Error('expected a valid session');
    expect(first.refreshed).toBe(false);

    advance(60_000);
    expect(await service.validate(token)).toMatchObject({ refreshed: false });
    const untouched = await sessionRow(first.sessionId);
    expect(untouched.lastSeenAt).toEqual(START);
    expect(untouched.expiresAt).toEqual(new Date(START.getTime() + 30 * DAY));

    advance(1);
    const refreshed = await service.validate(token);
    expect(refreshed).toMatchObject({ refreshed: true });
    const row = await sessionRow(first.sessionId);
    expect(row.lastSeenAt).toEqual(now);
    expect(row.expiresAt).toEqual(new Date(now.getTime() + 30 * DAY));
    expect(refreshed?.expiresAt).toEqual(row.expiresAt);
  });

  it('renews the cookie with the required flags when the session is extended', async () => {
    const { token } = await service.create(userId, 'email_code', 'Browser/1');
    advance(120_000);
    const response = await request(app.getHttpServer())
      .get('/api/probe/me')
      .set('Cookie', cookie(token))
      .expect(200);
    const header = (response.headers['set-cookie'] as unknown as string[] | undefined)?.[0] ?? '';
    const attributes = header.split('; ');
    expect(attributes[0]).toBe(`${SESSION_COOKIE}=${token}`);
    expect(attributes).toEqual(
      expect.arrayContaining(['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']),
    );
    expect(attributes).toContain(`Max-Age=${30 * 24 * 3600}`);
    expect(attributes.some((attribute) => attribute.toLowerCase().startsWith('domain='))).toBe(
      false,
    );
  });

  it('answers a protected route without a cookie with 401 in the error format', async () => {
    const response = await request(app.getHttpServer()).get('/api/probe/me').expect(401);
    const body = response.body as { code: string; traceId: unknown };
    expect(body.code).toBe('auth.required');
    expect(typeof body.traceId).toBe('string');
    expect(Object.keys(body).sort()).toEqual(['code', 'traceId']);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('checks the Origin before the session on mutating requests', async () => {
    const forged = await request(app.getHttpServer()).post('/api/probe/write').expect(403);
    expect(forged.body).toMatchObject({ code: 'auth.badOrigin' });
    await request(app.getHttpServer()).post('/api/probe/write').set('Origin', origin).expect(401);
  });

  it('keeps @Public() routes and the health endpoints reachable without a session', async () => {
    await request(app.getHttpServer()).get('/api/probe/open').expect(200);
    await request(app.getHttpServer()).get('/api/health/live').expect(200);
    await request(app.getHttpServer()).get('/api/health/ready').expect(200);
  });

  describe('cleanup job', () => {
    it('removes only expired codes and sessions expired or revoked more than 30 days ago', async () => {
      await connection.sql`delete from sessions`;
      await connection.sql`delete from email_login_codes`;
      const at = (days: number): Date => new Date(now.getTime() + days * DAY);
      const session = async (tag: string, expires: Date, revoked: Date | null): Promise<string> => {
        const [row] = await connection.db
          .insert(sessions)
          .values({
            tokenHash: `hash-${tag}`,
            userId,
            authMethod: 'email_code',
            userAgent: tag,
            lastSeenAt: START,
            expiresAt: expires,
            absoluteExpiresAt: at(180),
            revokedAt: revoked,
          })
          .returning({ id: sessions.id });
        return row?.id ?? '';
      };
      await session('active', at(10), null);
      await session('expired-recently', at(-5), null);
      await session('expired-long-ago', at(-31), null);
      await session('revoked-recently', at(10), at(-5));
      await session('revoked-long-ago', at(10), at(-31));
      const code = (tag: string, expires: Date) => ({
        email: `${tag}@example.org`,
        codeHash: 'x',
        browserNonceHash: 'y',
        expiresAt: expires,
      });
      await connection.db
        .insert(emailLoginCodes)
        .values([code('valid', at(0.005)), code('expired', at(-0.005))]);

      const result = await app.get(CleanupJob).run();

      expect(result).toEqual({ sessions: 2, codes: 1 });
      const remaining = await connection.db.select({ tag: sessions.userAgent }).from(sessions);
      expect(remaining.map((row) => row.tag).sort()).toEqual([
        'active',
        'expired-recently',
        'revoked-recently',
      ]);
      const codes = await connection.db
        .select({ email: emailLoginCodes.email })
        .from(emailLoginCodes);
      expect(codes).toEqual([{ email: 'valid@example.org' }]);
    });
  });
});
