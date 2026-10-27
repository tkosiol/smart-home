import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { meSchema } from '@smart/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DEVICE_MESSAGE_HANDLER, type DeviceMessageHandler } from '../src/core/devices/index.js';
import { GATEWAY_STATUS_CHANGED, GatewayEvents } from '../src/core/gateways/index.js';
import { LIVE_OPTIONS, LiveHub } from '../src/core/live/index.js';
import { SESSION_COOKIE, SessionService, UsersRepository } from '../src/core/identity/index.js';
import {
  DATABASE,
  type DatabaseConnection,
  runMigrations,
} from '../src/platform/database/index.js';
import { MQTT_CONNECTION, type MqttConnection } from '../src/platform/mqtt/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';

const HOUSEHOLDS = '/api/v1/households';

interface Person {
  id: string;
  cookie: string;
}
interface Household {
  id: string;
  owner: Person;
  viewer: Person;
  gatewayId: string;
}

/** An open event stream: what arrived so far, and whether the server ended it. */
interface Stream {
  status: number;
  headers: http.IncomingHttpHeaders;
  text(): string;
  ended(): boolean;
  waitFor(needle: string, timeoutMs?: number): Promise<void>;
  close(): void;
}

describe('live event stream of a household', () => {
  let app: INestApplication<App>;
  let connection: DatabaseConnection;
  let port: number;
  let closed = false;
  let counter = 0;
  const streams: Stream[] = [];
  const originalUrl = inject('testEnv').DATABASE_URL;
  const origin = inject('testEnv').APP_ORIGIN;

  const signedIn = async (): Promise<Person> => {
    const email = `live${(counter += 1)}@example.org`;
    const user = await app.get(UsersRepository).create({ email, displayName: `Live ${counter}` });
    const { token } = await app.get(SessionService).create(user.id, 'email_code', 'Browser/1');
    return { id: user.id, cookie: `${SESSION_COOKIE}=${token}` };
  };
  const post = (path: string, who: Person, body: object) =>
    request(app.getHttpServer())
      .post(path)
      .set('Cookie', who.cookie)
      .set('Origin', origin)
      .send(body);

  const open = (path: string, cookie?: string): Promise<Stream> =>
    new Promise((resolve, reject) => {
      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      if (cookie) headers['Cookie'] = cookie;
      const req = http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
        let received = '';
        let over = false;
        const listeners = new Set<() => void>();
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          received += chunk;
          for (const notify of [...listeners]) notify();
        });
        const finish = () => {
          over = true;
          for (const notify of [...listeners]) notify();
        };
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', finish);
        const stream: Stream = {
          status: res.statusCode ?? 0,
          headers: res.headers,
          text: () => received,
          ended: () => over,
          close: () => req.destroy(),
          waitFor: (needle, timeoutMs = 4000) =>
            new Promise<void>((done, fail) => {
              const check = () => {
                if (received.includes(needle)) {
                  clearTimeout(timer);
                  listeners.delete(check);
                  done();
                } else if (over) {
                  clearTimeout(timer);
                  listeners.delete(check);
                  fail(new Error(`stream ended without ${needle}: ${received}`));
                }
              };
              const timer = setTimeout(() => {
                listeners.delete(check);
                fail(new Error(`timeout waiting for ${needle}: ${received}`));
              }, timeoutMs);
              listeners.add(check);
              check();
            }),
        };
        streams.push(stream);
        resolve(stream);
      });
      req.on('error', reject);
    });
  const untilEnded = async (stream: Stream, timeoutMs = 4000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!stream.ended()) {
      if (Date.now() > deadline) throw new Error(`stream did not end: ${stream.text()}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  /** A household with an owner, a viewer and a gateway. */
  const household = async (): Promise<Household> => {
    const owner = await signedIn();
    const viewer = await signedIn();
    const created = await post(HOUSEHOLDS, owner, { name: 'Home', timezone: 'Europe/Berlin' });
    const id = meSchema.parse(created.body).currentHouseholdId;
    if (!id) throw new Error('no current household');
    await connection.sql`
      insert into memberships (household_id, user_id, role) values (${id}, ${viewer.id}, 'viewer')`;
    const gatewayId = `gw-${randomBytes(4).toString('hex')}`;
    await connection.sql`
      insert into gateways (id, household_id, name, topic_prefix, cert_fingerprint, cert_expires_at,
        bridge_status, z2m_status, status_changed_at, last_message_at)
      values (${gatewayId}, ${id}, 'Pi', ${`gw/${gatewayId}/z2m`}, 'fingerprint',
        now() + interval '1 year', 'online', 'online', now() - interval '1 hour', now())`;
    return { id, owner, viewer, gatewayId };
  };

  /** A plant sensor assigned to a device; returns the device and its hardware. */
  const addPlant = async (home: Household): Promise<{ deviceId: string; hardwareId: string }> => {
    const [row] = await connection.sql<{ id: string }[]>`
      insert into hardware (gateway_id, ieee_address, friendly_name, vendor, model, availability,
        last_state, first_seen_at, last_seen_at)
      values (${home.gatewayId}, ${`0x${randomBytes(8).toString('hex')}`}, 'Ficus', 'AOYAN',
        'AY-303Z', 'online', '{}'::jsonb, now(), now())
      returning id`;
    if (!row) throw new Error('no hardware');
    await connection.sql`
      insert into capabilities (hardware_id, key, kind, unit, readable, writable, is_setting)
      values (${row.id}, 'soil_moisture', 'numeric', '%', true, false, false)`;
    const response = await post(`${HOUSEHOLDS}/${home.id}/devices`, home.owner, {
      hardwareId: row.id,
      name: 'Ficus',
    }).expect(201);
    return { deviceId: (response.body as { id: string }).id, hardwareId: row.id };
  };

  beforeAll(async () => {
    const url = await createFreshDatabase(originalUrl);
    await runMigrations(url);
    process.env.DATABASE_URL = url;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LIVE_OPTIONS)
      .useValue({ heartbeatMs: 200, throttleMs: 50 })
      .compile();
    app = moduleRef.createNestApplication<INestApplication<App>>();
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');
    port = Number(new URL(await app.getUrl()).port);
    await app.get<MqttConnection>(MQTT_CONNECTION).waitUntilConnected(5000);
    connection = app.get<DatabaseConnection>(DATABASE);
  });

  afterEach(() => {
    for (const stream of streams.splice(0)) stream.close();
  });

  afterAll(async () => {
    if (!closed) await app.close();
    process.env.DATABASE_URL = originalUrl;
  });

  it('opens an event stream with the right headers and a first comment', async () => {
    const home = await household();
    const stream = await open(`/api/v1/households/${home.id}/events`, home.viewer.cookie);
    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(stream.headers['cache-control']).toBe('no-cache, no-transform');
    expect(stream.headers['x-accel-buffering']).toBe('no');
    await stream.waitFor(': connected');
    await stream.waitFor(': ping');
  });

  it('answers 401 without a session and 404 to a stranger', async () => {
    const home = await household();
    const stranger = await signedIn();
    const anonymous = await open(`/api/v1/households/${home.id}/events`);
    expect(anonymous.status).toBe(401);
    const foreign = await open(`/api/v1/households/${home.id}/events`, stranger.cookie);
    expect(foreign.status).toBe(404);
  });

  it('sends a new reading to the viewer as device.state', async () => {
    const home = await household();
    const { deviceId, hardwareId } = await addPlant(home);
    const stream = await open(`/api/v1/households/${home.id}/events`, home.viewer.cookie);
    await stream.waitFor(': connected');
    const handler = app.get<DeviceMessageHandler>(DEVICE_MESSAGE_HANDLER, { strict: false });
    await handler.handle(home.gatewayId, hardwareId, { soil_moisture: 42 }, new Date(), false);
    await stream.waitFor('event: device.state');
    const text = stream.text();
    expect(text).toContain(`"id":"${deviceId}"`);
    expect(text).toMatch(/"soil_moisture":42/);
  });

  it('sends gateway.status to the owner and not to the viewer', async () => {
    const home = await household();
    const owner = await open(`/api/v1/households/${home.id}/events`, home.owner.cookie);
    const viewer = await open(`/api/v1/households/${home.id}/events`, home.viewer.cookie);
    await Promise.all([owner.waitFor(': connected'), viewer.waitFor(': connected')]);
    await connection.sql`update gateways set bridge_status = 'offline' where id = ${home.gatewayId}`;
    app.get(GatewayEvents).emit(GATEWAY_STATUS_CHANGED, { gatewayId: home.gatewayId });
    await owner.waitFor('event: gateway.status');
    expect(owner.text()).toContain(`"id":"${home.gatewayId}"`);
    await viewer.waitFor(': ping');
    expect(viewer.text()).not.toContain('gateway.status');
  });

  it('ends the stream after the heartbeat once the membership is gone', async () => {
    const home = await household();
    const stream = await open(`/api/v1/households/${home.id}/events`, home.viewer.cookie);
    await stream.waitFor(': connected');
    await connection.sql`
      delete from memberships where household_id = ${home.id} and user_id = ${home.viewer.id}`;
    await untilEnded(stream);
  });

  it('drops a client from the hub when it disconnects', async () => {
    const home = await household();
    const hub = app.get(LiveHub);
    const stream = await open(`/api/v1/households/${home.id}/events`, home.viewer.cookie);
    await stream.waitFor(': connected');
    expect(hub.watching(home.id)).toBe(true);
    stream.close();
    const deadline = Date.now() + 4000;
    while (hub.watching(home.id) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(hub.watching(home.id)).toBe(false);
  });

  it('ends open streams when the app shuts down', async () => {
    const home = await household();
    const stream = await open(`/api/v1/households/${home.id}/events`, home.owner.cookie);
    await stream.waitFor(': connected');
    closed = true;
    await app.close();
    await untilEnded(stream);
  });
});
