import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { apiErrorSchema, memberSchema, meSchema, type Me } from '@smart/contracts';
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

const ME = '/api/v1/me';
const HOUSEHOLDS = '/api/v1/households';
const UNKNOWN_ID = '3b241101-e2bb-4255-8caf-4136c566a962';

interface TestUser {
  id: string;
  cookie: string;
  displayName: string;
}

describe('household members and roles', () => {
  let app: INestApplication<App>;
  let connection: DatabaseConnection;
  let counter = 0;
  const originalUrl = inject('testEnv').DATABASE_URL;
  const origin = inject('testEnv').APP_ORIGIN;

  const signedIn = async (displayName = `Member ${(counter += 1)}`): Promise<TestUser> => {
    const email = `members${(counter += 1)}@example.org`;
    const user = await app.get(UsersRepository).create({ email, displayName });
    const { token } = await app.get(SessionService).create(user.id, 'email_code', 'Browser/1');
    return { id: user.id, cookie: `${SESSION_COOKIE}=${token}`, displayName };
  };
  const call = (
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    cookie: string,
  ): request.Test => {
    const server = app.getHttpServer();
    const base = request(server);
    const test =
      method === 'get'
        ? base.get(path)
        : method === 'post'
          ? base.post(path)
          : method === 'put'
            ? base.put(path)
            : method === 'patch'
              ? base.patch(path)
              : base.delete(path);
    return test.set('Cookie', cookie).set('Origin', origin);
  };
  const membersPath = (householdId: string, userId?: string): string =>
    `${HOUSEHOLDS}/${householdId}/members${userId ? `/${userId}` : ''}`;
  const createHousehold = async (owner: TestUser): Promise<string> => {
    const response = await call('post', HOUSEHOLDS, owner.cookie)
      .send({ name: 'Home', timezone: 'Europe/Berlin' })
      .expect(201);
    const id = meSchema.parse(response.body).currentHouseholdId;
    if (!id) throw new Error('no current household');
    return id;
  };
  const addMember = async (householdId: string, user: TestUser, role: string): Promise<void> => {
    await connection.sql`
      insert into memberships (household_id, user_id, role) values (${householdId}, ${user.id}, ${role})`;
  };
  const roleOf = async (householdId: string, userId: string): Promise<string | undefined> => {
    const rows = await connection.sql<{ role: string }[]>`
      select role from memberships where household_id = ${householdId} and user_id = ${userId}`;
    return rows[0]?.role;
  };
  const ownerCount = async (householdId: string): Promise<number> => {
    const rows = await connection.sql<{ count: number }[]>`
      select count(*)::int as count from memberships
      where household_id = ${householdId} and role = 'owner'`;
    return rows[0]?.count ?? 0;
  };
  const getMe = async (cookie: string): Promise<Me> => {
    const response = await call('get', ME, cookie).expect(200);
    return meSchema.parse(response.body);
  };
  const errorCode = (response: request.Response): string =>
    apiErrorSchema.parse(response.body).code;

  /** A household with the given users added in the given roles; the first user owns it. */
  const household = async (
    ...roles: ('owner' | 'member' | 'viewer')[]
  ): Promise<{ id: string; users: TestUser[] }> => {
    const users = await Promise.all(roles.map(() => signedIn()));
    const [first, ...others] = users;
    if (!first) throw new Error('a household needs a first user');
    const id = await createHousehold(first);
    for (const [index, user] of others.entries()) {
      await addMember(id, user, roles[index + 1] ?? 'viewer');
    }
    return { id, users };
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
    connection = app.get<DatabaseConnection>(DATABASE);
  });

  afterAll(async () => {
    await app.close();
    process.env.DATABASE_URL = originalUrl;
  });

  describe('GET /households/:householdId/members', () => {
    it('lists the members by name for a viewer', async () => {
      const owner = await signedIn('Zoe');
      const viewer = await signedIn('Anna');
      const member = await signedIn('Max');
      const id = await createHousehold(owner);
      await addMember(id, viewer, 'viewer');
      await addMember(id, member, 'member');
      const response = await call('get', membersPath(id), viewer.cookie).expect(200);
      const members = (response.body as unknown[]).map((entry) => memberSchema.parse(entry));
      expect(members.map(({ displayName, role }) => [displayName, role])).toEqual([
        ['Anna', 'viewer'],
        ['Max', 'member'],
        ['Zoe', 'owner'],
      ]);
      expect(members[0]).toMatchObject({ userId: viewer.id });
      expect(members[0]?.email).toMatch(/@example\.org$/);
      expect(members[0]?.joinedAt).toMatch(/Z$/);
    });

    it('answers a non-member with 404 household.notFound', async () => {
      const { id } = await household('owner');
      const stranger = await signedIn();
      const response = await call('get', membersPath(id), stranger.cookie).expect(404);
      expect(errorCode(response)).toBe('household.notFound');
    });
  });

  describe('PATCH /households/:householdId/members/:userId', () => {
    it('lets an owner change a role', async () => {
      const { id, users } = await household('owner', 'member');
      const [owner, member] = users as [TestUser, TestUser];
      await call('patch', membersPath(id, member.id), owner.cookie)
        .send({ role: 'viewer' })
        .expect(204);
      expect(await roleOf(id, member.id)).toBe('viewer');
    });

    it('lets an owner promote another owner and demote themself afterwards', async () => {
      const { id, users } = await household('owner', 'member');
      const [owner, member] = users as [TestUser, TestUser];
      await call('patch', membersPath(id, member.id), owner.cookie)
        .send({ role: 'owner' })
        .expect(204);
      await call('patch', membersPath(id, owner.id), owner.cookie)
        .send({ role: 'member' })
        .expect(204);
      expect(await ownerCount(id)).toBe(1);
    });

    it('answers a member with 403 household.forbidden and changes nothing', async () => {
      const { id, users } = await household('owner', 'member');
      const [owner, member] = users as [TestUser, TestUser];
      const response = await call('patch', membersPath(id, member.id), member.cookie)
        .send({ role: 'owner' })
        .expect(403);
      expect(errorCode(response)).toBe('household.forbidden');
      expect(await roleOf(id, member.id)).toBe('member');
      expect(await roleOf(id, owner.id)).toBe('owner');
    });

    it('rejects an unknown role with 400 validation.failed', async () => {
      const { id, users } = await household('owner', 'member');
      const [owner, member] = users as [TestUser, TestUser];
      const response = await call('patch', membersPath(id, member.id), owner.cookie)
        .send({ role: 'root' })
        .expect(400);
      expect(errorCode(response)).toBe('validation.failed');
      expect(await roleOf(id, member.id)).toBe('member');
    });

    it('keeps the last owner: demoting themself answers 409 household.lastOwner', async () => {
      const { id, users } = await household('owner', 'member');
      const [owner] = users as [TestUser, TestUser];
      const response = await call('patch', membersPath(id, owner.id), owner.cookie)
        .send({ role: 'member' })
        .expect(409);
      expect(errorCode(response)).toBe('household.lastOwner');
      expect(await roleOf(id, owner.id)).toBe('owner');
    });

    it('lets the last owner keep the owner role (no change)', async () => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      await call('patch', membersPath(id, owner.id), owner.cookie)
        .send({ role: 'owner' })
        .expect(204);
    });

    it('answers a user of another household with 404 household.notFound, nothing changes', async () => {
      const own = await household('owner');
      const other = await household('owner', 'member');
      const [ownOwner] = own.users as [TestUser];
      const [otherOwner, otherMember] = other.users as [TestUser, TestUser];
      const response = await call('patch', membersPath(own.id, otherMember.id), ownOwner.cookie)
        .send({ role: 'viewer' })
        .expect(404);
      expect(errorCode(response)).toBe('household.notFound');
      expect(await roleOf(other.id, otherMember.id)).toBe('member');
      expect(await roleOf(other.id, otherOwner.id)).toBe('owner');
    });

    it.each(['not-a-uuid', UNKNOWN_ID])('answers the user id %s with 404', async (userId) => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const response = await call('patch', membersPath(id, userId), owner.cookie)
        .send({ role: 'viewer' })
        .expect(404);
      expect(errorCode(response)).toBe('household.notFound');
    });
  });

  describe('DELETE /households/:householdId/members/:userId', () => {
    it('lets an owner remove another member', async () => {
      const { id, users } = await household('owner', 'member');
      const [owner, member] = users as [TestUser, TestUser];
      await call('delete', membersPath(id, member.id), owner.cookie).expect(204);
      expect(await roleOf(id, member.id)).toBeUndefined();
    });

    it('lets a member leave: 204, and /me no longer lists the household', async () => {
      const { id, users } = await household('owner', 'member');
      const [, member] = users as [TestUser, TestUser];
      expect((await getMe(member.cookie)).households.map((entry) => entry.id)).toEqual([id]);
      await call('delete', membersPath(id, member.id), member.cookie).expect(204);
      expect(await getMe(member.cookie)).toMatchObject({
        households: [],
        currentHouseholdId: null,
      });
    });

    it('lets a viewer leave', async () => {
      const { id, users } = await household('owner', 'viewer');
      const [, viewer] = users as [TestUser, TestUser];
      await call('delete', membersPath(id, viewer.id), viewer.cookie).expect(204);
      expect(await roleOf(id, viewer.id)).toBeUndefined();
    });

    it('lets one of two owners leave', async () => {
      const { id, users } = await household('owner', 'owner');
      const [first, second] = users as [TestUser, TestUser];
      await call('delete', membersPath(id, first.id), first.cookie).expect(204);
      expect(await roleOf(id, second.id)).toBe('owner');
      expect(await ownerCount(id)).toBe(1);
    });

    it('answers a member removing someone else with 403 household.forbidden', async () => {
      const { id, users } = await household('owner', 'member', 'member');
      const [owner, member, other] = users as [TestUser, TestUser, TestUser];
      for (const target of [owner, other]) {
        const response = await call('delete', membersPath(id, target.id), member.cookie).expect(
          403,
        );
        expect(errorCode(response)).toBe('household.forbidden');
      }
      expect(await roleOf(id, owner.id)).toBe('owner');
      expect(await roleOf(id, other.id)).toBe('member');
    });

    it('keeps the last owner: leaving answers 409 household.lastOwner', async () => {
      const { id, users } = await household('owner', 'member');
      const [owner] = users as [TestUser, TestUser];
      const response = await call('delete', membersPath(id, owner.id), owner.cookie).expect(409);
      expect(errorCode(response)).toBe('household.lastOwner');
      expect(await roleOf(id, owner.id)).toBe('owner');
    });

    it('accepts the own id in upper case', async () => {
      const { id, users } = await household('owner', 'member');
      const [, member] = users as [TestUser, TestUser];
      await call('delete', membersPath(id, member.id.toUpperCase()), member.cookie).expect(204);
      expect(await roleOf(id, member.id)).toBeUndefined();
    });

    it('answers a user of another household with 404, nothing changes', async () => {
      const own = await household('owner');
      const other = await household('owner', 'member');
      const [ownOwner] = own.users as [TestUser];
      const [, otherMember] = other.users as [TestUser, TestUser];
      const response = await call(
        'delete',
        membersPath(own.id, otherMember.id),
        ownOwner.cookie,
      ).expect(404);
      expect(errorCode(response)).toBe('household.notFound');
      expect(await roleOf(other.id, otherMember.id)).toBe('member');
    });

    it.each(['not-a-uuid', UNKNOWN_ID])('answers the user id %s with 404', async (userId) => {
      const { id, users } = await household('owner');
      const [owner] = users as [TestUser];
      const response = await call('delete', membersPath(id, userId), owner.cookie).expect(404);
      expect(errorCode(response)).toBe('household.notFound');
    });

    it('falls back to another household when the current one was left', async () => {
      const { id, users } = await household('owner', 'member');
      const [, member] = users as [TestUser, TestUser];
      const second = await createHousehold(member);
      await call('put', ME, member.cookie).send({ householdId: id }).expect(200);
      expect((await getMe(member.cookie)).currentHouseholdId).toBe(id);
      await call('delete', membersPath(id, member.id), member.cookie).expect(204);
      expect(await getMe(member.cookie)).toMatchObject({ currentHouseholdId: second });
    });
  });

  describe('the last owner under concurrency', () => {
    /** Waits until `count` statements of the API wait for a row lock. */
    const waitForLockWaiters = async (count: number): Promise<void> => {
      const deadline = Date.now() + 10_000;
      for (;;) {
        const rows = await connection.sql<{ waiting: number }[]>`
          select count(*)::int as waiting from pg_stat_activity
          where application_name = 'smart-api' and wait_event_type = 'Lock'
            and datname = current_database()`;
        if ((rows[0]?.waiting ?? 0) >= count) return;
        if (Date.now() > deadline) throw new Error('requests never reached the row lock');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };

    it('lets exactly one of two owners demote each other: 409 for the other, one owner left', async () => {
      const { id, users } = await household('owner', 'owner');
      const [first, second] = users as [TestUser, TestUser];

      // Hold the row locks while both requests are sent. Both pass the guard (both are owners),
      // then both queue on the lock; releasing it lets them run strictly one after the other.
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => (locked = resolve));
      const holder = connection.sql.begin(async (tx) => {
        await tx`select 1 from memberships where household_id = ${id} for update`;
        locked();
        await released;
      });
      await lockTaken;
      const both = Promise.all([
        call('patch', membersPath(id, second.id), first.cookie).send({ role: 'member' }),
        call('patch', membersPath(id, first.id), second.cookie).send({ role: 'member' }),
      ]);
      await waitForLockWaiters(2);
      release();
      await holder;
      const responses = await both;

      expect(responses.map((response) => response.status).sort()).toEqual([204, 409]);
      const failed = responses.find((response) => response.status === 409);
      expect(failed && errorCode(failed)).toBe('household.lastOwner');
      expect(await ownerCount(id)).toBe(1);
    });

    it('lets exactly one of two owners leave concurrently', async () => {
      const { id, users } = await household('owner', 'owner');
      const [first, second] = users as [TestUser, TestUser];
      // Whatever the interleaving, the second request is refused (409, or 404 once the first one
      // is gone), so exactly one succeeds and one owner stays.
      const responses = await Promise.all([
        call('delete', membersPath(id, first.id), first.cookie),
        call('delete', membersPath(id, second.id), second.cookie),
      ]);
      expect(responses.filter((response) => response.status === 204)).toHaveLength(1);
      expect(await ownerCount(id)).toBe(1);
    });
  });
});
