import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  apiErrorSchema,
  invitationCreatedSchema,
  invitationPreviewSchema,
  invitationSchema,
  meSchema,
  type InvitationCreated,
} from '@smart/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { inject, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { HouseholdsCleanupJob } from '../src/core/households/index.js';
import {
  CLOCK,
  LOGIN_NONCE_COOKIE,
  sha256,
  SESSION_COOKIE,
  SessionService,
  UsersRepository,
} from '../src/core/identity/index.js';
import {
  DATABASE,
  type DatabaseConnection,
  runMigrations,
} from '../src/platform/database/index.js';
import { MAIL_SENDER, type MailMessage, type MailSender } from '../src/platform/mail/index.js';
import { MQTT_CONNECTION, type MqttConnection } from '../src/platform/mqtt/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';

const DAY = 86_400_000;
const START = new Date('2026-03-01T10:00:00Z');
const ME = '/api/v1/me';
const HOUSEHOLDS = '/api/v1/households';
const INVITATIONS = '/api/v1/invitations';
const UNKNOWN_ID = '3b241101-e2bb-4255-8caf-4136c566a962';

class InMemoryMailSender implements MailSender {
  enabled = true;
  failing = false;
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    // A real transport error quotes the address and often more.
    if (this.failing) throw new Error(`550 rejected ${message.to}: ${message.text}`);
    await Promise.resolve();
  }

  to(address: string): MailMessage[] {
    return this.sent.filter((message) => message.to === address);
  }
}

interface TestUser {
  id: string;
  email: string;
  displayName: string;
  cookie: string;
}

describe('household invitations', () => {
  let app: INestApplication<App>;
  let connection: DatabaseConnection;
  let now = START;
  let counter = 0;
  let ipCounter = 0;
  const mailer = new InMemoryMailSender();
  const originalUrl = inject('testEnv').DATABASE_URL;
  const origin = inject('testEnv').APP_ORIGIN;

  /** A fresh client address per call: the per-IP limits must not leak between tests. */
  const nextIp = (): string => `198.51.100.${(ipCounter = (ipCounter % 250) + 1)}`;
  const advance = (ms: number): void => {
    now = new Date(now.getTime() + ms);
  };
  const guestEmail = (): string => `guest${(counter += 1)}@example.org`;
  const signedIn = async (email = `inv${(counter += 1)}@example.org`): Promise<TestUser> => {
    const displayName = `User ${counter}`;
    const user = await app.get(UsersRepository).create({ email, displayName });
    const { token } = await app.get(SessionService).create(user.id, 'email_code', 'Browser/1');
    return { id: user.id, email, displayName, cookie: `${SESSION_COOKIE}=${token}` };
  };
  const call = (
    method: 'get' | 'post' | 'delete',
    path: string,
    options: { cookie?: string; ip?: string } = {},
  ): request.Test => {
    const base = request(app.getHttpServer());
    const test =
      method === 'get' ? base.get(path) : method === 'post' ? base.post(path) : base.delete(path);
    test.set('Origin', origin).set('X-Forwarded-For', options.ip ?? nextIp());
    return options.cookie ? test.set('Cookie', options.cookie) : test;
  };
  const errorCode = (response: request.Response): string =>
    apiErrorSchema.parse(response.body).code;
  const invitationsPath = (householdId: string, invitationId?: string, action?: string): string =>
    [`${HOUSEHOLDS}/${householdId}/invitations`, invitationId, action].filter(Boolean).join('/');
  const tokenOf = (created: InvitationCreated): string => {
    const token = created.link.split('/').at(-1);
    if (!token) throw new Error('link without token');
    return token;
  };

  /** A household with the given users added in the given roles; the first user owns it. */
  const household = async (
    ...roles: ('owner' | 'member' | 'viewer')[]
  ): Promise<{ id: string; users: TestUser[] }> => {
    const users = await Promise.all(roles.map(() => signedIn()));
    const [first, ...others] = users;
    if (!first) throw new Error('a household needs a first user');
    const response = await call('post', HOUSEHOLDS, { cookie: first.cookie })
      .send({ name: 'Home', timezone: 'Europe/Berlin' })
      .expect(201);
    const id = meSchema.parse(response.body).currentHouseholdId;
    if (!id) throw new Error('no current household');
    for (const [index, user] of others.entries()) {
      await connection.sql`
        insert into memberships (household_id, user_id, role)
        values (${id}, ${user.id}, ${roles[index + 1] ?? 'viewer'})`;
    }
    return { id, users };
  };
  const invite = async (
    householdId: string,
    owner: TestUser,
    email = guestEmail(),
    role: 'owner' | 'member' | 'viewer' = 'member',
  ): Promise<InvitationCreated> => {
    const response = await call('post', invitationsPath(householdId), { cookie: owner.cookie })
      .send({ email, role })
      .expect(201);
    return invitationCreatedSchema.parse(response.body);
  };
  const preview = (token: string, ip?: string): request.Test =>
    call('post', `${INVITATIONS}/preview`, { ip }).send({ token });
  const accept = (token: string, cookie: string): request.Test =>
    call('post', `${INVITATIONS}/accept`, { cookie }).send({ token });
  const acceptNew = (token: string, body: object = { displayName: 'Gast', locale: 'en' }) =>
    call('post', `${INVITATIONS}/accept-new`).send({ token, ...body });
  const roleOf = async (householdId: string, userId: string): Promise<string | undefined> => {
    const rows = await connection.sql<{ role: string }[]>`
      select role from memberships where household_id = ${householdId} and user_id = ${userId}`;
    return rows[0]?.role;
  };
  const userCount = async (email: string): Promise<number> => {
    const rows = await connection.sql<{ count: number }[]>`
      select count(*)::int as count from users where email = ${email}`;
    return rows[0]?.count ?? 0;
  };

  beforeAll(async () => {
    const url = await createFreshDatabase(originalUrl);
    await runMigrations(url);
    process.env.DATABASE_URL = url;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(() => now)
      .overrideProvider(MAIL_SENDER)
      .useValue(mailer)
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    configureApp(app);
    await app.init();
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
    mailer.failing = false;
    mailer.sent.length = 0;
  });

  describe('POST /households/:householdId/invitations', () => {
    it('creates an invitation as owner: link in the answer and the mail, only the hash stored', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const email = guestEmail();
      const created = await invite(id, owner, email, 'viewer');

      const token = tokenOf(created);
      expect(created.link).toBe(`${origin}/einladung/${token}`);
      expect(created.invitation).toMatchObject({
        email,
        role: 'viewer',
        invitedByName: owner.displayName,
        createdAt: START.toISOString(),
        expiresAt: new Date(START.getTime() + 7 * DAY).toISOString(),
      });
      const mails = mailer.to(email);
      expect(mails).toHaveLength(1);
      expect(mails[0]?.text).toContain(created.link);
      expect(mails[0]?.subject).toContain('Home');

      const rows = await connection.sql<{ token_hash: string }[]>`
        select token_hash from invitations where id = ${created.invitation.id}`;
      expect(rows[0]?.token_hash).toBe(sha256(token));
      const stored = JSON.stringify(await connection.sql`select * from invitations`);
      expect(stored).not.toContain(token);
    });

    it('normalizes the address and mails in the language of the inviter', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      await connection.sql`update users set locale = 'en' where id = ${owner.id}`;
      const email = guestEmail();
      const response = await call('post', invitationsPath(id), { cookie: owner.cookie })
        .send({ email: ` ${email.toUpperCase()} `, role: 'member' })
        .expect(201);
      expect(invitationCreatedSchema.parse(response.body).invitation.email).toBe(email);
      expect(mailer.to(email)[0]?.html).toContain('<html lang="en">');
    });

    it.each(['member', 'viewer'] as const)(
      'answers a %s with 403 and creates nothing',
      async (role) => {
        const { id, users } = await household('owner', role);
        const [, caller] = users as [TestUser, TestUser];
        const response = await call('post', invitationsPath(id), { cookie: caller.cookie })
          .send({ email: guestEmail(), role: 'viewer' })
          .expect(403);
        expect(errorCode(response)).toBe('household.forbidden');
        expect(mailer.sent).toHaveLength(0);
      },
    );

    it('answers a member of the household with 409 invitation.alreadyMember', async () => {
      const { id, users } = await household('owner', 'viewer');
      const [owner, viewer] = users as [TestUser, TestUser];
      const response = await call('post', invitationsPath(id), { cookie: owner.cookie })
        .send({ email: viewer.email.toUpperCase(), role: 'member' })
        .expect(409);
      expect(errorCode(response)).toBe('invitation.alreadyMember');
      expect(mailer.sent).toHaveLength(0);
    });

    it('rejects a malformed address with 400 validation.failed', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const response = await call('post', invitationsPath(id), { cookie: owner.cookie })
        .send({ email: 'nope', role: 'member' })
        .expect(400);
      expect(errorCode(response)).toBe('validation.failed');
    });

    it('lets a second invitation for the same address invalidate the first', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const email = guestEmail();
      const first = await invite(id, owner, email, 'viewer');
      const second = await invite(id, owner, email, 'member');

      expect(errorCode(await preview(tokenOf(first)).expect(404))).toBe('invitation.invalid');
      await preview(tokenOf(second)).expect(200);
      const list = await call('get', invitationsPath(id), { cookie: owner.cookie }).expect(200);
      expect((list.body as { id: string }[]).map((entry) => entry.id)).toEqual([
        second.invitation.id,
      ]);
    });

    it('works without mail: 201 with the link, nothing sent', async () => {
      mailer.enabled = false;
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const created = await invite(id, owner);
      expect(created.link).toContain('/einladung/');
      await preview(tokenOf(created)).expect(200);
    });

    it('does not wait for a failing mail and logs neither token nor full address', async () => {
      mailer.failing = true;
      const logged: string[] = [];
      const record = (...args: unknown[]): void => {
        logged.push(
          args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '),
        );
      };
      const spies = (['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const).map((level) =>
        vi.spyOn(Logger.prototype, level).mockImplementation(record),
      );
      try {
        const { id, users } = await household('owner');
        const [owner] = users as [TestUser];
        const email = guestEmail();
        const created = await invite(id, owner, email);
        await vi.waitFor(() => expect(mailer.sent).toHaveLength(1));
        await vi.waitFor(() => expect(logged.length).toBeGreaterThan(0));

        const everything = logged.join('\n');
        expect(everything).toContain('g***@example.org');
        expect(everything).not.toContain(tokenOf(created));
        expect(everything).not.toContain(email);

        // Accepting leaves no trace either.
        await acceptNew(tokenOf(created)).expect(200);
        expect(logged.join('\n')).not.toContain(tokenOf(created));
        expect(logged.join('\n')).not.toContain(email);
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });
  });

  describe('GET /households/:householdId/invitations', () => {
    it('lists the open invitations only, for an owner only', async () => {
      const { id, users } = await household('owner', 'member');
      const [owner, member] = users as [TestUser, TestUser];
      await invite(id, owner); // expires before the others are created
      advance(8 * DAY);
      const open = await invite(id, owner);
      const revoked = await invite(id, owner);
      const accepted = await invite(id, owner);
      await call('delete', invitationsPath(id, revoked.invitation.id), {
        cookie: owner.cookie,
      }).expect(204);
      await acceptNew(tokenOf(accepted)).expect(200);

      const response = await call('get', invitationsPath(id), { cookie: owner.cookie }).expect(200);
      const entries = (response.body as unknown[]).map((entry) => invitationSchema.parse(entry));
      expect(entries.map((entry) => entry.id)).toEqual([open.invitation.id]);

      const forbidden = await call('get', invitationsPath(id), { cookie: member.cookie }).expect(
        403,
      );
      expect(errorCode(forbidden)).toBe('household.forbidden');
    });
  });

  describe('POST .../:invitationId/resend', () => {
    it('issues a new token and a new 7 days: the old link dies, the new one works', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const email = guestEmail();
      const created = await invite(id, owner, email, 'viewer');
      advance(3 * DAY);

      const response = await call('post', invitationsPath(id, created.invitation.id, 'resend'), {
        cookie: owner.cookie,
      }).expect(201);
      const resent = invitationCreatedSchema.parse(response.body);

      expect(resent.invitation).toMatchObject({
        id: created.invitation.id,
        email,
        role: 'viewer',
        expiresAt: new Date(now.getTime() + 7 * DAY).toISOString(),
      });
      expect(tokenOf(resent)).not.toBe(tokenOf(created));
      expect(errorCode(await preview(tokenOf(created)).expect(404))).toBe('invitation.invalid');
      await preview(tokenOf(resent)).expect(200);
      expect(mailer.to(email)).toHaveLength(2);
      expect(mailer.to(email)[1]?.text).toContain(resent.link);
    });

    it('revives an expired invitation but not a revoked or accepted one', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const expired = await invite(id, owner);
      advance(8 * DAY);
      await call('post', invitationsPath(id, expired.invitation.id, 'resend'), {
        cookie: owner.cookie,
      }).expect(201);

      const revoked = await invite(id, owner);
      await call('delete', invitationsPath(id, revoked.invitation.id), {
        cookie: owner.cookie,
      }).expect(204);
      const accepted = await invite(id, owner);
      await acceptNew(tokenOf(accepted)).expect(200);
      for (const gone of [revoked, accepted]) {
        const response = await call('post', invitationsPath(id, gone.invitation.id, 'resend'), {
          cookie: owner.cookie,
        }).expect(404);
        expect(errorCode(response)).toBe('household.notFound');
      }
    });

    it('answers a member with 403', async () => {
      const { id, users } = await household('owner', 'member');
      const [owner, member] = users as [TestUser, TestUser];
      const created = await invite(id, owner);
      await call('post', invitationsPath(id, created.invitation.id, 'resend'), {
        cookie: member.cookie,
      }).expect(403);
      await preview(tokenOf(created)).expect(200);
    });
  });

  describe('DELETE .../:invitationId', () => {
    it('revokes the invitation: 204, then the link is invalid', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const created = await invite(id, owner);
      await call('delete', invitationsPath(id, created.invitation.id), {
        cookie: owner.cookie,
      }).expect(204);
      expect(errorCode(await preview(tokenOf(created)).expect(404))).toBe('invitation.invalid');
      const stranger = await signedIn(created.invitation.email);
      expect(errorCode(await accept(tokenOf(created), stranger.cookie).expect(404))).toBe(
        'invitation.invalid',
      );
    });

    it.each(['not-a-uuid', UNKNOWN_ID])(
      'answers the id %s with 404 household.notFound',
      async (invitationId) => {
        const { id, users } = await household('owner');
        const [owner] = users as [TestUser];
        for (const method of ['delete', 'post'] as const) {
          const path =
            method === 'delete'
              ? invitationsPath(id, invitationId)
              : invitationsPath(id, invitationId, 'resend');
          const response = await call(method, path, { cookie: owner.cookie }).expect(404);
          expect(errorCode(response)).toBe('household.notFound');
        }
      },
    );
  });

  describe('POST /invitations/preview', () => {
    it('previews household, role, address, inviter and whether an account exists', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const newcomer = await invite(id, owner, guestEmail(), 'viewer');
      const known = await signedIn();
      const knownInvitation = await invite(id, owner, known.email, 'member');

      const fresh = invitationPreviewSchema.parse(
        (await preview(tokenOf(newcomer)).expect(200)).body,
      );
      expect(fresh).toEqual({
        householdName: 'Home',
        role: 'viewer',
        email: newcomer.invitation.email,
        invitedByName: owner.displayName,
        accountExists: false,
      });
      const existing = invitationPreviewSchema.parse(
        (await preview(tokenOf(knownInvitation)).expect(200)).body,
      );
      expect(existing).toMatchObject({ accountExists: true, role: 'member' });
    });

    it.each([
      ['unknown', () => 'x'.repeat(43)],
      ['malformed', () => '%20'],
    ])('answers an %s token with 404 invitation.invalid', async (_name, token) => {
      expect(errorCode(await preview(token()).expect(404))).toBe('invitation.invalid');
    });

    it('answers an expired invitation with 404 invitation.invalid', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const created = await invite(id, owner);
      advance(7 * DAY - 1);
      await preview(tokenOf(created)).expect(200);
      advance(1);
      expect(errorCode(await preview(tokenOf(created)).expect(404))).toBe('invitation.invalid');
    });

    it.each(['preview', 'accept', 'accept-new'])(
      'requires the token in the body of %s: 400 validation.failed',
      async (route) => {
        const cookie = (await signedIn()).cookie;
        for (const body of [{}, { token: '' }, { token: 'x'.repeat(101) }]) {
          const response = await call('post', `${INVITATIONS}/${route}`, { cookie })
            .send({ displayName: 'Gast', locale: 'en', ...body })
            .expect(400);
          expect(errorCode(response)).toBe('validation.failed');
        }
      },
    );

    it('has no route with the token in the URL', async () => {
      await call('get', `${INVITATIONS}/${'z'.repeat(43)}`).expect(404);
      await call('post', `${INVITATIONS}/${'z'.repeat(43)}/accept-new`)
        .send({ displayName: 'Gast', locale: 'en' })
        .expect(404);
    });

    it('limits requests to 20 per address in 15 minutes', async () => {
      const ip = '203.0.113.77';
      const token = 'y'.repeat(43);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await preview(token, ip).expect(404);
      }
      const response = await preview(token, ip).expect(429);
      expect(errorCode(response)).toBe('auth.rateLimited');
      await preview(token, '203.0.113.78').expect(404);
    });
  });

  describe('POST /invitations/accept', () => {
    it('adds the signed-in invitee with the invited role and answers /me', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const guest = await signedIn();
      const created = await invite(id, owner, guest.email, 'viewer');

      const response = await accept(tokenOf(created), guest.cookie).expect(200);
      const me = meSchema.parse(response.body);

      expect(me.currentHouseholdId).toBe(id);
      expect(me.households).toEqual([
        { id, name: 'Home', timezone: 'Europe/Berlin', role: 'viewer' },
      ]);
      expect(await roleOf(id, guest.id)).toBe('viewer');
      const rows = await connection.sql<{ at: number }[]>`
        select (extract(epoch from accepted_at) * 1000)::float8 as at from invitations
        where id = ${created.invitation.id}`;
      expect(rows[0]?.at).toBe(START.getTime());
      expect(errorCode(await accept(tokenOf(created), guest.cookie).expect(404))).toBe(
        'invitation.invalid',
      );
    });

    it('makes the accepted household the current one', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const guest = await signedIn();
      const own = await call('post', HOUSEHOLDS, { cookie: guest.cookie })
        .send({ name: 'Mine', timezone: 'Europe/Berlin' })
        .expect(201);
      expect(meSchema.parse(own.body).currentHouseholdId).not.toBe(id);
      const created = await invite(id, owner, guest.email);
      const me = meSchema.parse((await accept(tokenOf(created), guest.cookie).expect(200)).body);
      expect(me.currentHouseholdId).toBe(id);
      expect(me.households).toHaveLength(2);
    });

    it('requires a session', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const created = await invite(id, owner);
      const response = await call('post', `${INVITATIONS}/accept`)
        .send({ token: tokenOf(created) })
        .expect(401);
      expect(errorCode(response)).toBe('auth.required');
      await preview(tokenOf(created)).expect(200);
    });

    it('answers another address with 403 invitation.emailMismatch and keeps the invitation open', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const intruder = await signedIn();
      const created = await invite(id, owner);
      const response = await accept(tokenOf(created), intruder.cookie).expect(403);
      expect(errorCode(response)).toBe('invitation.emailMismatch');
      expect(await roleOf(id, intruder.id)).toBeUndefined();
      await preview(tokenOf(created)).expect(200);
    });

    it('leaves the role of an existing member unchanged and still uses up the invitation', async () => {
      const { id, users } = await household('owner', 'viewer');
      const [owner, viewer] = users as [TestUser, TestUser];
      // The member was invited before joining another way; the role of the invitation is ignored.
      const created = await invite(id, owner, guestEmail(), 'owner');
      await connection.sql`update users set email = ${created.invitation.email} where id = ${viewer.id}`;

      await accept(tokenOf(created), viewer.cookie).expect(200);
      expect(await roleOf(id, viewer.id)).toBe('viewer');
      expect(errorCode(await preview(tokenOf(created)).expect(404))).toBe('invitation.invalid');
    });

    it('answers an expired invitation with 404 invitation.invalid', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const guest = await signedIn();
      const created = await invite(id, owner, guest.email);
      advance(7 * DAY);
      expect(errorCode(await accept(tokenOf(created), guest.cookie).expect(404))).toBe(
        'invitation.invalid',
      );
      expect(await roleOf(id, guest.id)).toBeUndefined();
    });
  });

  describe('POST /invitations/accept-new', () => {
    it('creates the account, the membership and a session with the flags of 4a', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const email = guestEmail();
      const created = await invite(id, owner, email, 'viewer');

      const response = await acceptNew(tokenOf(created), {
        displayName: ' Gast ',
        locale: 'en',
      }).expect(200);

      const me = meSchema.parse(response.body);
      expect(me).toMatchObject({
        email,
        displayName: 'Gast',
        locale: 'en',
        currentHouseholdId: id,
      });
      expect(me.households).toEqual([
        { id, name: 'Home', timezone: 'Europe/Berlin', role: 'viewer' },
      ]);
      expect(await userCount(email)).toBe(1);
      const cookie = (response.headers['set-cookie'] as unknown as string[]).find((line) =>
        line.startsWith(`${SESSION_COOKIE}=`),
      );
      expect(cookie).toMatch(/; Path=\//);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toMatch(/Max-Age=\d+/);
      expect(cookie).not.toContain('Domain');

      const sessions = await connection.sql<{ auth_method: string }[]>`
        select s.auth_method from sessions s join users u on u.id = s.user_id where u.email = ${email}`;
      expect(sessions.map((row) => row.auth_method)).toEqual(['invitation']);
      const pair = cookie?.split(';')[0] ?? '';
      const next = await call('get', ME, { cookie: pair }).expect(200);
      expect(meSchema.parse(next.body).email).toBe(email);
    });

    it('uses the invitation up: a second acceptance answers 404 invitation.invalid', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const created = await invite(id, owner);
      await acceptNew(tokenOf(created)).expect(200);
      expect(errorCode(await acceptNew(tokenOf(created)).expect(404))).toBe('invitation.invalid');
    });

    it('answers an existing account with 409 invitation.accountExists and changes nothing', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const known = await signedIn();
      const created = await invite(id, owner, known.email);
      const response = await acceptNew(tokenOf(created)).expect(409);
      expect(errorCode(response)).toBe('invitation.accountExists');
      expect(await userCount(known.email)).toBe(1);
      expect(await roleOf(id, known.id)).toBeUndefined();
      // Rolled back as a whole: the invitation stays open for the sign-in route.
      await preview(tokenOf(created)).expect(200);
    });

    it('rejects an invalid body with 400 and leaves the invitation open', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const created = await invite(id, owner);
      const response = await acceptNew(tokenOf(created), { displayName: '', locale: 'fr' }).expect(
        400,
      );
      expect(errorCode(response)).toBe('validation.failed');
      await preview(tokenOf(created)).expect(200);
    });

    it('lets exactly one of two concurrent acceptances succeed: the other is invitation.invalid', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const email = guestEmail();
      const created = await invite(id, owner, email);

      const responses = await Promise.all([
        acceptNew(tokenOf(created)),
        acceptNew(tokenOf(created)),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 404]);
      const loser = responses.find((response) => response.status === 404);
      expect(loser && errorCode(loser)).toBe('invitation.invalid');
      expect(await userCount(email)).toBe(1);
    });

    it('lets exactly one of two invitations for the same new address create the account', async () => {
      const first = await household('owner');
      const second = await household('owner');
      const email = guestEmail();
      const a = await invite(first.id, first.users[0], email);
      const b = await invite(second.id, second.users[0], email);

      const responses = await Promise.all([acceptNew(tokenOf(a)), acceptNew(tokenOf(b))]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const loser = responses.find((response) => response.status === 409);
      expect(loser && errorCode(loser)).toBe('invitation.accountExists');
      expect(await userCount(email)).toBe(1);
    });
  });

  describe('first e-mail-code sign-in after accept-new', () => {
    const sessionCookieOf = (response: request.Response): string => {
      const line = (response.headers['set-cookie'] as unknown as string[]).find((entry) =>
        entry.startsWith(`${SESSION_COOKIE}=`),
      );
      const pair = line?.split(';')[0];
      if (!pair) throw new Error('no session cookie');
      return pair;
    };
    /** Signs in like the invitee's own browser, with the code from the mailbox. */
    const signInByCode = async (email: string): Promise<string> => {
      const requested = await call('post', '/api/v1/auth/email-code').send({ email }).expect(204);
      const nonce = (requested.headers['set-cookie'] as unknown as string[])
        .find((entry) => entry.startsWith(`${LOGIN_NONCE_COOKIE}=`))
        ?.split(';')[0];
      const code = /\b(\d{6})\b/.exec(mailer.to(email).at(-1)?.text ?? '')?.[1];
      if (!nonce || !code) throw new Error('no nonce or code');
      const response = await call('post', '/api/v1/auth/email-code/verify', { cookie: nonce })
        .send({ email, code })
        .expect(200);
      return sessionCookieOf(response);
    };

    it('ends a session someone else got through the link, but keeps ordinary code sessions', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const email = guestEmail();
      const created = await invite(id, owner, email);
      // The inviter holds the token too: his browser creates the account and keeps the cookie.
      const foreign = sessionCookieOf(await acceptNew(tokenOf(created)).expect(200));
      await call('get', ME, { cookie: foreign }).expect(200);
      const user = await app.get(UsersRepository).findByEmail(email);
      if (!user) throw new Error('account missing');
      const { token } = await app.get(SessionService).create(user.id, 'email_code', 'Other/1');
      const otherDevice = `${SESSION_COOKIE}=${token}`;

      const own = await signInByCode(email);

      expect(errorCode(await call('get', ME, { cookie: foreign }).expect(401))).toBe(
        'auth.required',
      );
      expect(meSchema.parse((await call('get', ME, { cookie: own }).expect(200)).body).email).toBe(
        email,
      );
      await call('get', ME, { cookie: otherDevice }).expect(200);
    });

    it('revokes invitation sessions only once the code is proven, not on a request', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const email = guestEmail();
      const foreign = sessionCookieOf(
        await acceptNew(tokenOf(await invite(id, owner, email))).expect(200),
      );
      await call('post', '/api/v1/auth/email-code').send({ email }).expect(204);
      await call('get', ME, { cookie: foreign }).expect(200);
    });
  });

  describe('cleanup', () => {
    it('removes invitations that expired, were revoked or accepted over 30 days ago', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const expired = await invite(id, owner);
      const revoked = await invite(id, owner);
      const accepted = await invite(id, owner);
      await call('delete', invitationsPath(id, revoked.invitation.id), {
        cookie: owner.cookie,
      }).expect(204);
      await acceptNew(tokenOf(accepted)).expect(200);
      const ids = async (): Promise<string[]> =>
        (
          await connection.sql<{ id: string }[]>`
            select id from invitations where household_id = ${id}`
        )
          .map((row) => row.id)
          .sort();

      // 31 days on: revoked and accepted 31 days ago, but expired only 24 days ago.
      advance(31 * DAY);
      await app.get(HouseholdsCleanupJob).run(); // the whole table: other tests left rows too
      expect(await ids()).toEqual([expired.invitation.id]);

      // 45 days on: expired 38 days ago; a fresh one stays.
      advance(14 * DAY);
      // The owner's session went idle meanwhile: sign in again.
      const { token } = await app.get(SessionService).create(owner.id, 'email_code', 'Browser/1');
      const fresh = await invite(id, { ...owner, cookie: `${SESSION_COOKIE}=${token}` });
      await app.get(HouseholdsCleanupJob).run();
      expect(await ids()).toEqual([fresh.invitation.id]);
    });
  });
});
