import { Controller, Post, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { meSchema } from '@smart/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import {
  CLOCK,
  LOGIN_NONCE_COOKIE,
  SESSION_COOKIE,
  UsersRepository,
} from '../src/core/identity/index.js';
import {
  DATABASE,
  type DatabaseConnection,
  runMigrations,
} from '../src/platform/database/index.js';
import { RateLimit } from '../src/platform/http/index.js';
import { MAIL_SENDER, type MailMessage, type MailSender } from '../src/platform/mail/index.js';
import { MQTT_CONNECTION, type MqttConnection } from '../src/platform/mqtt/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';

const MINUTE = 60_000;
const START = new Date('2026-03-01T10:00:00Z');
const EMAIL_CODE = '/api/v1/auth/email-code';
const VERIFY = `${EMAIL_CODE}/verify`;
const LOGOUT = '/api/v1/auth/logout';

/** Records synchronously on `send`, so a test can read the mail as soon as the response arrived. */
class InMemoryMailSender implements MailSender {
  enabled = true;
  delayMs = 0;
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
  }

  to(address: string): MailMessage[] {
    return this.sent.filter((message) => message.to === address);
  }

  codeFor(address: string, index = -1): string {
    const message = this.to(address).at(index);
    const code = /\b(\d{6})\b/.exec(message?.text ?? '')?.[1];
    if (!code) throw new Error(`no code mailed to ${address}`);
    return code;
  }
}

@Controller('probe')
class ProbeController {
  /** Protected (no @Public) and rate limited: the limit must answer before the session check. */
  @Post('guarded')
  @RateLimit('emailCodeRequestPerIp')
  guarded(): { ok: true } {
    return { ok: true };
  }
}

describe('auth: e-mail code sign-in and sign-out', () => {
  let app: INestApplication<App>;
  let connection: DatabaseConnection;
  let now = START;
  let userCounter = 0;
  let ipCounter = 0;
  let ghostCounter = 0;
  const mailer = new InMemoryMailSender();
  const originalUrl = inject('testEnv').DATABASE_URL;
  const origin = inject('testEnv').APP_ORIGIN;

  /** A fresh client address per call: the per-IP limits must not leak between tests. */
  const nextIp = (): string => `203.0.113.${(ipCounter = (ipCounter % 250) + 1)}`;
  /** An address without an account; unique per use because the per-address limits are in memory. */
  const ghost = (): string => `ghost${(ghostCounter += 1)}@example.org`;
  const advance = (ms: number): void => {
    now = new Date(now.getTime() + ms);
  };
  const newUser = async (locale: 'de' | 'en' = 'de'): Promise<string> => {
    const email = `user${(userCounter += 1)}@example.org`;
    await app.get(UsersRepository).create({ email, displayName: `User ${userCounter}`, locale });
    return email;
  };
  const setCookies = (response: request.Response): string[] =>
    (response.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const cookieValue = (response: request.Response, name: string): string | undefined => {
    const header = setCookies(response).find((line) => line.startsWith(`${name}=`));
    return header?.split(';')[0]?.slice(name.length + 1);
  };
  const post = (
    path: string,
    body: unknown,
    options: { cookies?: string[]; ip?: string; origin?: string | null } = {},
  ): request.Test => {
    const call = request(app.getHttpServer())
      .post(path)
      .set('X-Forwarded-For', options.ip ?? nextIp())
      .send(body as object);
    if (options.origin !== null) call.set('Origin', options.origin ?? origin);
    if (options.cookies?.length) call.set('Cookie', options.cookies.join('; '));
    return call;
  };
  /** Requests a code like a browser would; returns that browser's nonce cookie. */
  const requestCode = async (email: string, nonce?: string): Promise<string> => {
    const response = await post(
      EMAIL_CODE,
      { email },
      { cookies: nonce ? [`${LOGIN_NONCE_COOKIE}=${nonce}`] : [] },
    ).expect(204);
    const issued = cookieValue(response, LOGIN_NONCE_COOKIE);
    if (!issued) throw new Error('no nonce cookie');
    return issued;
  };
  const verify = (email: string, code: string, nonce?: string, ip?: string): request.Test =>
    post(VERIFY, { email, code }, { cookies: nonce ? [`${LOGIN_NONCE_COOKIE}=${nonce}`] : [], ip });
  /** Status and body without the per-request trace id, for comparing responses. */
  const shape = (response: request.Response): { status: number; body: unknown } => ({
    status: response.status,
    body: Object.fromEntries(
      Object.entries(response.body as Record<string, unknown>).filter(([key]) => key !== 'traceId'),
    ),
  });
  const wrongCode = (real: string): string => (real === '000000' ? '000001' : '000000');
  const codeRow = async (email: string) => {
    const rows = await connection.sql`
      select code_hash, attempts, used_at from email_login_codes
      where email = ${email} order by created_at desc, id`;
    return rows[0];
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
      .overrideProvider(MAIL_SENDER)
      .useValue(mailer)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    configureApp(app);
    await app.init();
    // Listening once keeps supertest from opening a server per parallel request.
    await app.listen(0, '127.0.0.1');
    await app.get<MqttConnection>(MQTT_CONNECTION).waitUntilConnected(5000);
    connection = app.get<DatabaseConnection>(DATABASE);
  });

  afterAll(async () => {
    await app.close();
    process.env.DATABASE_URL = originalUrl;
  });

  beforeEach(() => {
    now = START;
    mailer.enabled = true;
    mailer.delayMs = 0;
    mailer.sent.length = 0;
  });

  describe('requesting a code', () => {
    it('mails exactly one code to a known address and stores only hashes', async () => {
      const email = await newUser();
      const response = await post(EMAIL_CODE, { email }).expect(204);

      expect(response.text).toBe('');
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]?.to).toBe(email);
      const code = mailer.codeFor(email);
      expect(code).toMatch(/^\d{6}$/);

      const row = await codeRow(email);
      expect(row?.code_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row?.code_hash).not.toBe(code);
      const stored = JSON.stringify(await connection.sql`select * from email_login_codes`);
      expect(stored).not.toContain(code);
      expect(stored).not.toContain(cookieValue(response, LOGIN_NONCE_COOKIE) ?? 'missing');
    });

    it('mails in the language of the user', async () => {
      const english = await newUser('en');
      await post(EMAIL_CODE, { email: english }).expect(204);
      expect(mailer.to(english)[0]?.subject).toContain('sign-in code');
    });

    it('sets the nonce cookie with the required flags and keeps a nonce the browser already has', async () => {
      const email = await newUser();
      const response = await post(EMAIL_CODE, { email }).expect(204);
      const header = setCookies(response).find((line) => line.startsWith(LOGIN_NONCE_COOKIE));
      const attributes = (header ?? '').split('; ');
      expect(attributes[0]).toMatch(new RegExp(`^${LOGIN_NONCE_COOKIE}=[A-Za-z0-9_-]{43}$`));
      expect(attributes).toEqual(
        expect.arrayContaining(['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']),
      );
      expect(attributes).toContain(`Max-Age=${15 * 60}`);
      expect(attributes.some((attribute) => attribute.toLowerCase().startsWith('domain='))).toBe(
        false,
      );

      const nonce = cookieValue(response, LOGIN_NONCE_COOKIE) ?? '';
      expect(await requestCode(email, nonce)).toBe(nonce);
      expect(await requestCode(await newUser(), 'not-a-valid-nonce')).not.toBe('not-a-valid-nonce');
    });

    it('answers an unknown address like a known one without mail or database writes', async () => {
      const before = await connection.sql`select count(*)::int as n from email_login_codes`;
      const email = ghost();
      const response = await post(EMAIL_CODE, { email }).expect(204);

      expect(response.text).toBe('');
      expect(cookieValue(response, LOGIN_NONCE_COOKIE)).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(mailer.sent).toHaveLength(0);
      const after = await connection.sql`select count(*)::int as n from email_login_codes`;
      expect(after[0]?.n).toBe(before[0]?.n);
      expect(await connection.sql`select id from users where email = ${email}`).toEqual([]);
    });

    it('does not make the response time depend on the mail server, known or unknown', async () => {
      mailer.delayMs = 1500;
      const timed = async (email: string): Promise<number> => {
        const start = performance.now();
        await post(EMAIL_CODE, { email }).expect(204);
        return performance.now() - start;
      };
      await timed(await newUser()); // warm up connections
      const known: number[] = [];
      const unknown: number[] = [];
      for (let i = 0; i < 3; i++) {
        known.push(await timed(await newUser()));
        unknown.push(await timed(ghost()));
      }
      const median = (values: number[]): number => [...values].sort((a, b) => a - b)[1] ?? 0;
      expect(median(known)).toBeLessThan(750);
      expect(Math.abs(median(known) - median(unknown))).toBeLessThan(250);
    });

    it('treats case and surrounding spaces in the address as irrelevant', async () => {
      const email = await newUser();
      const messy = `  ${email.toUpperCase()} `;
      const nonce = await requestCode(messy);
      expect(mailer.to(email)).toHaveLength(1);

      const response = await verify(messy, mailer.codeFor(email), nonce).expect(200);
      expect(response.body).toMatchObject({ email });
    });

    it('rejects malformed bodies with the validation error', async () => {
      for (const body of [{}, { email: 'not-an-address' }, { email: 42 }]) {
        const response = await post(EMAIL_CODE, body).expect(400);
        expect(response.body).toMatchObject({ code: 'validation.failed' });
      }
      expect(mailer.sent).toHaveLength(0);
    });

    it('answers 503 auth.mailDisabled when mail is switched off', async () => {
      mailer.enabled = false;
      const email = await newUser();
      const response = await post(EMAIL_CODE, { email }).expect(503);
      expect(response.body).toMatchObject({ code: 'auth.mailDisabled' });
      expect(await codeRow(email)).toBeUndefined();
      await post(EMAIL_CODE, { email: ghost() }).expect(503);
    });

    it('allows 3 codes per address in 15 minutes and 429 on the 4th, then again later', async () => {
      const email = await newUser();
      await requestCode(email);
      advance(MINUTE);
      await requestCode(email);
      advance(MINUTE);
      await requestCode(email);
      advance(MINUTE);
      const response = await post(EMAIL_CODE, { email }).expect(429);
      expect(response.body).toMatchObject({
        code: 'auth.rateLimited',
        params: { retryAfterSeconds: 12 * 60 },
      });
      expect(mailer.to(email)).toHaveLength(3);

      advance(12 * MINUTE);
      await requestCode(email);
      expect(mailer.to(email)).toHaveLength(4);
    });

    it('limits an unknown address exactly like a known one, with the same response', async () => {
      const bodies: unknown[] = [];
      for (const email of [await newUser(), ghost()]) {
        for (let i = 0; i < 3; i++) await requestCode(email);
        const response = await post(EMAIL_CODE, { email }).expect(429);
        bodies.push(shape(response).body);
      }
      expect(bodies[0]).toEqual({ code: 'auth.rateLimited', params: { retryAfterSeconds: 900 } });
      expect(bodies[1]).toEqual(bodies[0]);
    });

    it('never exceeds the per-address limit under concurrent requests', async () => {
      const email = await newUser();
      const responses = await Promise.all(
        Array.from({ length: 6 }, () => post(EMAIL_CODE, { email })),
      );
      const statuses = responses.map((response) => response.status).sort();
      expect(statuses).toEqual([204, 204, 204, 429, 429, 429]);
      expect(mailer.to(email)).toHaveLength(3);
      const open = await connection.sql`
        select id from email_login_codes where email = ${email} and used_at is null`;
      expect(open).toHaveLength(1);
    });

    it('limits requests per IP address to 10 in 15 minutes', async () => {
      const ip = '198.51.100.7';
      for (let i = 0; i < 10; i++) {
        await post(EMAIL_CODE, { email: ghost() }, { ip }).expect(204);
      }
      const response = await post(EMAIL_CODE, { email: ghost() }, { ip }).expect(429);
      expect(response.body).toMatchObject({ code: 'auth.rateLimited' });
      await post(EMAIL_CODE, { email: ghost() }, { ip: nextIp() }).expect(204);
    });

    it('applies the rate limit before the session check on a protected route', async () => {
      const ip = '198.51.100.8';
      const guarded = (): request.Test => post('/api/probe/guarded', {}, { ip });
      for (let i = 0; i < 10; i++) await guarded().expect(401);
      const response = await guarded().expect(429);
      expect(response.body).toMatchObject({ code: 'auth.rateLimited' });
    });

    it('requires the Origin header', async () => {
      const response = await post(EMAIL_CODE, { email: 'a@example.org' }, { origin: null }).expect(
        403,
      );
      expect(response.body).toMatchObject({ code: 'auth.badOrigin' });
    });
  });

  describe('verifying a code', () => {
    it('signs in with the right code: session cookie, me, nonce cookie removed', async () => {
      const email = await newUser();
      const nonce = await requestCode(email);
      const response = await verify(email, mailer.codeFor(email), nonce).expect(200);

      expect(meSchema.safeParse(response.body).success).toBe(true);
      expect(response.body).toMatchObject({ email, isPlatformAdmin: false });
      expect((response.body as { displayName: string }).displayName).toMatch(/^User \d+$/);
      const header = setCookies(response).find((line) => line.startsWith(`${SESSION_COOKIE}=`));
      const attributes = (header ?? '').split('; ');
      expect(attributes[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}$`));
      expect(attributes).toEqual(
        expect.arrayContaining(['Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']),
      );
      expect(attributes).toContain(`Max-Age=${30 * 24 * 3600}`);
      const cleared = setCookies(response).find((line) => line.startsWith(LOGIN_NONCE_COOKIE));
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

      const [session] = await connection.sql`
        select auth_method, user_agent, token_hash from sessions order by created_at desc limit 1`;
      expect(session?.auth_method).toBe('email_code');
      expect(session?.token_hash).not.toBe(cookieValue(response, SESSION_COOKIE));
      expect((await codeRow(email))?.used_at).not.toBeNull();
    });

    it('rejects a code used from another browser, without costing the owner an attempt', async () => {
      const email = await newUser();
      const nonce = await requestCode(email);
      const code = mailer.codeFor(email);

      for (const stranger of [undefined, 'A'.repeat(43), 'garbage']) {
        const response = await verify(email, code, stranger).expect(400);
        expect(response.body).toMatchObject({ code: 'auth.invalidCode' });
        expect(setCookies(response).some((line) => line.startsWith(SESSION_COOKIE))).toBe(false);
      }
      expect((await codeRow(email))?.attempts).toBe(0);
      await verify(email, code, nonce).expect(200);
    });

    it('rejects an expired code with the same auth.invalidCode as any other failure', async () => {
      const email = await newUser();
      const nonce = await requestCode(email);
      const code = mailer.codeFor(email);
      advance(10 * MINUTE);
      const response = await verify(email, code, nonce).expect(400);
      expect(response.body).toMatchObject({ code: 'auth.invalidCode' });
    });

    it('accepts the code until the last moment of its 10 minutes', async () => {
      const email = await newUser();
      const nonce = await requestCode(email);
      advance(10 * MINUTE - 1);
      await verify(email, mailer.codeFor(email), nonce).expect(200);
    });

    it('rejects a code that was already used, also with the right nonce', async () => {
      const email = await newUser();
      const nonce = await requestCode(email);
      const code = mailer.codeFor(email);
      await verify(email, code, nonce).expect(200);
      const again = await verify(email, code, nonce).expect(400);
      expect(again.body).toMatchObject({ code: 'auth.invalidCode' });
      expect(setCookies(again).some((line) => line.startsWith(SESSION_COOKIE))).toBe(false);
    });

    it('answers an unknown and a known address identically, up to the lock after 5 tries', async () => {
      const known = await newUser();
      const nonce = await requestCode(known);
      const real = mailer.codeFor(known);
      const unknown = ghost();
      const unknownNonce = await requestCode(unknown);
      const outcomes = async (email: string, browser: string): Promise<unknown[]> => {
        const results: unknown[] = [];
        for (let i = 0; i < 7; i++) {
          // The 6th and 7th try use the right code: a locked address must not let it through.
          const response = await verify(email, i < 5 ? wrongCode(real) : real, browser);
          results.push(shape(response));
        }
        return results;
      };
      const forKnown = await outcomes(known, nonce);
      const forUnknown = await outcomes(unknown, unknownNonce);
      expect(forUnknown).toEqual(forKnown);
      expect(forKnown.slice(0, 5)).toEqual(
        Array(5).fill({ status: 400, body: { code: 'auth.invalidCode' } }),
      );
      expect(forKnown.slice(5)).toEqual(
        Array(2).fill({ status: 429, body: { code: 'auth.tooManyAttempts' } }),
      );
    });

    it('locks a browser without the nonce after 5 tries but leaves the owner untouched', async () => {
      const email = await newUser();
      const nonce = await requestCode(email);
      const code = mailer.codeFor(email);
      for (let i = 0; i < 5; i++) await verify(email, code, 'S'.repeat(43)).expect(400);
      await verify(email, code, 'S'.repeat(43)).expect(429);
      expect((await codeRow(email))?.attempts).toBe(0);
      await verify(email, code, nonce).expect(200);
    });

    it('starts fresh tries when the browser asks for a new code, known address or not', async () => {
      for (const email of [await newUser(), ghost()]) {
        const nonce = await requestCode(email);
        for (let i = 0; i < 5; i++) await verify(email, '000000', nonce).expect(400);
        await verify(email, '000000', nonce).expect(429);
        await requestCode(email, nonce);
        await verify(email, '000000', nonce).expect(400);
      }
    });

    it('rejects an unknown address and an address that never asked for a code', async () => {
      const unknown = ghost();
      const nonce = await requestCode(unknown);
      for (const email of [unknown, await newUser()]) {
        const response = await verify(email, '123456', nonce).expect(400);
        expect(response.body).toMatchObject({ code: 'auth.invalidCode' });
      }
    });

    it('counts wrong codes, locks after 5 and then refuses even the right code', async () => {
      const email = await newUser();
      const nonce = await requestCode(email);
      const code = mailer.codeFor(email);
      for (let attempt = 1; attempt <= 5; attempt++) {
        const response = await verify(email, wrongCode(code), nonce).expect(400);
        expect(shape(response)).toEqual({ status: 400, body: { code: 'auth.invalidCode' } });
      }
      const locked = await verify(email, code, nonce).expect(429);
      expect(locked.body).toMatchObject({ code: 'auth.tooManyAttempts' });
      expect(setCookies(locked).some((line) => line.startsWith(SESSION_COOKIE))).toBe(false);
      expect((await codeRow(email))?.attempts).toBe(5);
    });

    it('still accepts the right code after 4 wrong ones', async () => {
      const email = await newUser();
      const nonce = await requestCode(email);
      const code = mailer.codeFor(email);
      for (let attempt = 0; attempt < 4; attempt++) {
        await verify(email, wrongCode(code), nonce).expect(400);
      }
      await verify(email, code, nonce).expect(200);
    });

    it('does not let parallel guesses exceed 5 attempts', async () => {
      const email = await newUser();
      const nonce = await requestCode(email);
      const code = mailer.codeFor(email);
      const responses = await Promise.all(
        Array.from({ length: 12 }, () => verify(email, wrongCode(code), nonce)),
      );
      expect(responses.filter((response) => response.status === 400)).toHaveLength(5);
      expect(responses.filter((response) => response.status === 429)).toHaveLength(7);
      expect((await codeRow(email))?.attempts).toBe(5);
      await verify(email, code, nonce).expect(429);
    });

    it('signs in only once when the right code arrives in parallel', async () => {
      const email = await newUser();
      const nonce = await requestCode(email);
      const code = mailer.codeFor(email);
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => verify(email, code, nonce)),
      );
      expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
      expect(responses.filter((response) => response.status === 400)).toHaveLength(4);
      const sessions = await connection.sql`
        select s.id from sessions s join users u on u.id = s.user_id where u.email = ${email}`;
      expect(sessions).toHaveLength(1);
    });

    it('invalidates the first code when a second one is requested', async () => {
      const email = await newUser();
      const nonce = await requestCode(email);
      advance(MINUTE);
      await requestCode(email, nonce);
      const [first, second] = [mailer.codeFor(email, 0), mailer.codeFor(email, 1)];
      expect(first).not.toBe(second);

      const stale = await verify(email, first, nonce).expect(400);
      expect(stale.body).toMatchObject({ code: 'auth.invalidCode' });
      await verify(email, second, nonce).expect(200);
    });

    it('limits verification per IP address to 20 in 15 minutes', async () => {
      const ip = '198.51.100.9';
      const email = await newUser();
      const nonce = await requestCode(email);
      const code = mailer.codeFor(email);
      for (let i = 0; i < 20; i++) {
        const response = await verify(ghost(), '123456', nonce, ip);
        expect(response.status).toBe(400);
      }
      const limited = await verify(email, code, nonce, ip).expect(429);
      expect(limited.body).toMatchObject({ code: 'auth.rateLimited' });
      await verify(email, code, nonce).expect(200);
    });

    it('rejects malformed bodies with the validation error', async () => {
      const email = await newUser();
      for (const body of [{}, { email }, { email, code: '12345' }, { email, code: 'abcdef' }]) {
        const response = await post(VERIFY, body).expect(400);
        expect(response.body).toMatchObject({ code: 'validation.failed' });
      }
    });
  });

  describe('signing out', () => {
    const signIn = async (): Promise<{ cookie: string; email: string }> => {
      const email = await newUser();
      const nonce = await requestCode(email);
      const response = await verify(email, mailer.codeFor(email), nonce).expect(200);
      return { cookie: `${SESSION_COOKIE}=${cookieValue(response, SESSION_COOKIE)}`, email };
    };

    it('revokes the session, clears the cookie and then answers 401', async () => {
      const { cookie, email } = await signIn();
      const other = await signIn();

      const response = await post(LOGOUT, {}, { cookies: [cookie] }).expect(204);
      expect(setCookies(response).find((line) => line.startsWith(SESSION_COOKIE))).toMatch(
        /Expires=Thu, 01 Jan 1970/,
      );
      const [row] = await connection.sql`
        select s.revoked_at from sessions s join users u on u.id = s.user_id
        where u.email = ${email}`;
      expect(row?.revoked_at).not.toBeNull();

      const again = await post(LOGOUT, {}, { cookies: [cookie] }).expect(401);
      expect(again.body).toMatchObject({ code: 'auth.required' });
      // Only this device was signed out.
      await post(LOGOUT, {}, { cookies: [other.cookie] }).expect(204);
    });

    it('needs a session and the Origin header', async () => {
      const { cookie } = await signIn();
      await post(LOGOUT, {}).expect(401);
      await post(LOGOUT, {}, { cookies: [cookie], origin: null }).expect(403);
      await post(LOGOUT, {}, { cookies: [cookie] }).expect(204);
    });
  });
});
