import { RequestMethod, type INestApplication, type Type } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { apiErrorSchema, invitationCreatedSchema, meSchema } from '@smart/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { HouseholdGuard } from '../src/core/households/index.js';
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

interface Ids {
  householdId: string;
  userId: string;
  invitationId: string;
}
type Method = 'get' | 'post' | 'patch' | 'delete';

/**
 * Every endpoint below `v1/households/:householdId`. Adding a route without a row fails the
 * "table covers every route" test; the HTTP checks then run for each row.
 */
const ENDPOINTS: { route: string; body?: object; crossIds?: true }[] = [
  { route: 'PATCH /v1/households/:householdId', body: { name: 'Hijacked' } },
  { route: 'GET /v1/households/:householdId/members' },
  {
    route: 'PATCH /v1/households/:householdId/members/:userId',
    body: { role: 'viewer' },
    crossIds: true,
  },
  { route: 'DELETE /v1/households/:householdId/members/:userId', crossIds: true },
  { route: 'GET /v1/households/:householdId/invitations' },
  {
    route: 'POST /v1/households/:householdId/invitations',
    body: { email: 'intruder@example.org', role: 'owner' },
  },
  {
    route: 'POST /v1/households/:householdId/invitations/:invitationId/resend',
    crossIds: true,
  },
  {
    route: 'DELETE /v1/households/:householdId/invitations/:invitationId',
    crossIds: true,
  },
];

const METHOD_NAMES: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PUT]: 'PUT',
};

const joinPath = (...parts: string[]): string =>
  `/${parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .join('/')}`;

describe('household tenancy', () => {
  let app: INestApplication<App>;
  let connection: DatabaseConnection;
  let counter = 0;
  const originalUrl = inject('testEnv').DATABASE_URL;
  const origin = inject('testEnv').APP_ORIGIN;

  const signedIn = async (): Promise<{ id: string; cookie: string }> => {
    const email = `tenant${(counter += 1)}@example.org`;
    const user = await app.get(UsersRepository).create({ email, displayName: `Tenant ${counter}` });
    const { token } = await app.get(SessionService).create(user.id, 'email_code', 'Browser/1');
    return { id: user.id, cookie: `${SESSION_COOKIE}=${token}` };
  };
  const send = (method: Method, path: string, cookie: string | undefined, body?: object) => {
    const base = request(app.getHttpServer());
    const test =
      method === 'get'
        ? base.get(path)
        : method === 'post'
          ? base.post(path)
          : method === 'patch'
            ? base.patch(path)
            : base.delete(path);
    test.set('Origin', origin);
    if (cookie) test.set('Cookie', cookie);
    return body ? test.send(body) : test;
  };
  const errorCode = (response: request.Response): string =>
    apiErrorSchema.parse(response.body).code;
  const pathOf = (route: string, ids: Ids): string =>
    `/api${(route.split(' ')[1] ?? '')
      .replace(':householdId', ids.householdId)
      .replace(':userId', ids.userId)
      .replace(':invitationId', ids.invitationId)}`;
  const methodOf = (route: string): Method => route.split(' ')[0]?.toLowerCase() as Method;

  /** Everything stored about one household, to prove that a foreign request changed nothing. */
  const snapshot = async (householdId: string): Promise<string> =>
    JSON.stringify(
      await connection.sql`
        select * from (
          select 'household' as kind, to_jsonb(h)::text as row from households h
          where h.id = ${householdId}
          union all
          select 'membership', to_jsonb(m)::text from memberships m
          where m.household_id = ${householdId}
          union all
          select 'invitation', to_jsonb(i)::text from invitations i
          where i.household_id = ${householdId}
        ) rows order by kind, row`,
    );

  interface Tenant {
    householdId: string;
    owner: { id: string; cookie: string };
    member: { id: string; cookie: string };
    invitationId: string;
  }
  const tenant = async (): Promise<Tenant> => {
    const owner = await signedIn();
    const member = await signedIn();
    const created = await send('post', HOUSEHOLDS, owner.cookie, {
      name: 'Home',
      timezone: 'Europe/Berlin',
    }).expect(201);
    const householdId = meSchema.parse(created.body).currentHouseholdId;
    if (!householdId) throw new Error('no current household');
    await connection.sql`
      insert into memberships (household_id, user_id, role)
      values (${householdId}, ${member.id}, 'member')`;
    const invitation = await send(
      'post',
      `${HOUSEHOLDS}/${householdId}/invitations`,
      owner.cookie,
      {
        email: `pending${(counter += 1)}@example.org`,
        role: 'viewer',
      },
    ).expect(201);
    return {
      householdId,
      owner,
      member,
      invitationId: invitationCreatedSchema.parse(invitation.body).invitation.id,
    };
  };

  let a: Tenant;
  let b: Tenant;

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
    a = await tenant();
    b = await tenant();
  });

  afterAll(async () => {
    await app.close();
    process.env.DATABASE_URL = originalUrl;
  });

  /** Controllers of every module with the routes they serve, read from the Nest metadata. */
  const controllers = (): { controller: Type<unknown>; path: string }[] =>
    [...app.get(ModulesContainer).values()]
      .flatMap((module) => [...module.controllers.values()])
      .flatMap(({ metatype }) => (metatype ? [metatype as Type<unknown>] : []))
      .map((controller) => ({
        controller,
        path: joinPath(Reflect.getMetadata(PATH_METADATA, controller) as string),
      }));
  const householdControllers = () =>
    controllers().filter(({ path }) => path.includes(':householdId'));

  describe('the wiring', () => {
    it('puts HouseholdGuard on every controller whose path contains :householdId', () => {
      const scoped = householdControllers();
      expect(scoped.length).toBeGreaterThanOrEqual(3);
      for (const { controller, path } of scoped) {
        const guards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[];
        expect(guards, `${controller.name} (${path})`).toContain(HouseholdGuard);
      }
    });

    it('has a row in the table for every household route', () => {
      const routes = householdControllers().flatMap(({ controller, path }) =>
        Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
          const handler = (controller.prototype as Record<string, unknown>)[name];
          if (typeof handler !== 'function') return [];
          const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
          if (method === undefined) return [];
          const sub = (Reflect.getMetadata(PATH_METADATA, handler) as string | undefined) ?? '';
          return [`${METHOD_NAMES[method] ?? String(method)} ${joinPath(path, sub)}`];
        }),
      );
      expect(routes.length).toBeGreaterThanOrEqual(8);
      expect(routes.sort()).toEqual(ENDPOINTS.map(({ route }) => route).sort());
    });
  });

  describe.each(ENDPOINTS)('$route', ({ route, body }) => {
    const idsOf = (own: Tenant, other: Tenant): Ids => ({
      householdId: other.householdId,
      userId: own.member.id,
      invitationId: own.invitationId,
    });

    it('answers a signed-in user of household A with 404 for the householdId of B', async () => {
      const before = await snapshot(b.householdId);
      const response = await send(
        methodOf(route),
        pathOf(route, idsOf(b, b)),
        a.owner.cookie,
        body,
      ).expect(404);
      expect(errorCode(response)).toBe('household.notFound');
      expect(await snapshot(b.householdId)).toBe(before);
    });

    it('answers a malformed or unknown householdId with 404', async () => {
      for (const householdId of ['not-a-uuid', UNKNOWN_ID]) {
        const response = await send(
          methodOf(route),
          pathOf(route, { ...idsOf(a, a), householdId }),
          a.owner.cookie,
          body,
        ).expect(404);
        expect(errorCode(response)).toBe('household.notFound');
      }
    });

    it('answers a request without a session with 401', async () => {
      const response = await send(
        methodOf(route),
        pathOf(route, idsOf(b, b)),
        undefined,
        body,
      ).expect(401);
      expect(errorCode(response)).toBe('auth.required');
    });
  });

  describe.each(ENDPOINTS.filter(({ crossIds }) => crossIds))('$route', ({ route, body }) => {
    it('answers ids of B inside the path of A with 404 and leaves B alone', async () => {
      const before = await snapshot(b.householdId);
      const beforeA = await snapshot(a.householdId);
      const ids: Ids = {
        householdId: a.householdId,
        userId: b.member.id,
        invitationId: b.invitationId,
      };
      const response = await send(methodOf(route), pathOf(route, ids), a.owner.cookie, body).expect(
        404,
      );
      expect(errorCode(response)).toBe('household.notFound');
      expect(await snapshot(b.householdId)).toBe(before);
      expect(await snapshot(a.householdId)).toBe(beforeA);
    });
  });
});
