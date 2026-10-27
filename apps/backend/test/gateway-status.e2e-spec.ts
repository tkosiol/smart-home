import { createServer } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { connect, type MqttClient } from 'mqtt';
import postgres from 'postgres';
import type { StartedTestContainer } from 'testcontainers';
import { inject, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import {
  GATEWAY_STATUS_MEMORY,
  GATEWAY_TOUCHED,
  GatewayEvents,
  type GatewayStatusMemory,
  type GatewayTouched,
} from '../src/core/gateways/index.js';
import { GatewaysService } from '../src/core/gateways/gateways.service.js';
import { CLOCK } from '../src/core/identity/index.js';
import { runMigrations } from '../src/platform/database/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';
import { startTestBroker } from './helpers/test-broker.js';
import { createTestCa, randomGatewayId, type TestCa } from './helpers/test-pki.js';

interface StatusRow {
  bridge_status: string;
  z2m_status: string;
  status_changed_at: Date | null;
  last_message_at: Date | null;
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('no port'));
      });
    });
  });

/** Polls instead of sleeping: the consumer works asynchronously behind the broker. */
const eventually = async (check: () => unknown, timeout = 15_000): Promise<void> => {
  await vi.waitFor(check, { timeout, interval: 100 });
};

describe('gateway status from the broker', () => {
  const testEnv = inject('testEnv');
  const originalEnv = { ...process.env };
  let ca: TestCa;
  let broker: StartedTestContainer;
  let publisher: MqttClient;
  let sql: postgres.Sql;
  let app: INestApplication;
  let householdId: string;
  let now = new Date();

  const publish = async (topic: string, payload: string, retain = false): Promise<void> => {
    await publisher.publishAsync(topic, payload, { qos: 1, retain });
  };
  const insertGateway = async (
    id: string,
    columns: { revoked?: boolean; bridge?: string } = {},
  ): Promise<void> => {
    await sql`
      insert into gateways (id, household_id, name, topic_prefix, cert_fingerprint, cert_expires_at,
        bridge_status, revoked_at)
      values (${id}, ${householdId}, 'Pi', ${`gw/${id}/z2m`}, 'fingerprint',
        now() + interval '300 days', ${columns.bridge ?? 'unknown'},
        ${columns.revoked ? now : null})`;
  };
  const rowOf = async (id: string): Promise<StatusRow> => {
    const [row] = await sql<StatusRow[]>`
      select bridge_status, z2m_status, status_changed_at, last_message_at
      from gateways where id = ${id}`;
    if (!row) throw new Error(`no gateway ${id}`);
    return row;
  };
  /** A message of a sentinel gateway proves that everything published before it was handled. */
  const flush = async (): Promise<void> => {
    const sentinel = randomGatewayId();
    await insertGateway(sentinel);
    await publish(`gw/${sentinel}/bridge/connection`, '1');
    await eventually(async () => expect((await rowOf(sentinel)).bridge_status).toBe('online'));
  };

  const retainedId = randomGatewayId();

  beforeAll(async () => {
    ca = createTestCa();
    const port = await freePort();
    broker = await startTestBroker(port);
    const url = await createFreshDatabase(testEnv.DATABASE_URL);
    await runMigrations(url);
    sql = postgres(url, { max: 2, onnotice: () => undefined });
    const [household] = await sql<{ id: string }[]>`
      insert into households (name, timezone) values ('Home', 'Europe/Berlin') returning id`;
    householdId = household?.id ?? '';
    publisher = connect(`mqtt://127.0.0.1:${port}`, {
      username: testEnv.MQTT_USERNAME,
      password: testEnv.MQTT_PASSWORD,
      clientId: `test-publisher-${randomGatewayId()}`,
    });
    await vi.waitFor(() => expect(publisher.connected).toBe(true), { timeout: 10_000 });
    // Retained before the consumer exists: it must pick this up when it starts.
    await insertGateway(retainedId);
    await publish(`gw/${retainedId}/bridge/connection`, '1', true);

    process.env.DATABASE_URL = url;
    process.env.MQTT_URL = `mqtt://127.0.0.1:${port}`;
    process.env.GATEWAY_CA_FILE = ca.file;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(() => now)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await publisher?.endAsync(true);
    await sql?.end();
    await broker?.stop();
    for (const name of ['DATABASE_URL', 'MQTT_URL', 'GATEWAY_CA_FILE']) {
      const original = originalEnv[name];
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
    ca?.dispose();
  });

  it('takes over a retained online message that was there before the consumer started', async () => {
    await eventually(async () => expect((await rowOf(retainedId)).bridge_status).toBe('online'));
    expect((await rowOf(retainedId)).status_changed_at).not.toBeNull();
  });

  it('sets the bridge offline on 0 and moves status_changed_at only on a change', async () => {
    const id = randomGatewayId();
    await insertGateway(id, { bridge: 'unknown' });
    now = new Date(Date.now() + 1000);
    await publish(`gw/${id}/bridge/connection`, '0');
    await eventually(async () => expect((await rowOf(id)).bridge_status).toBe('offline'));
    const changedAt = (await rowOf(id)).status_changed_at;
    expect(changedAt).toEqual(now);
    now = new Date(Date.now() + 5000);
    await publish(`gw/${id}/bridge/connection`, '0');
    await flush();
    expect((await rowOf(id)).status_changed_at).toEqual(changedAt);
  });

  it('reads the Zigbee2MQTT state as text and as JSON', async () => {
    const id = randomGatewayId();
    await insertGateway(id);
    await publish(`gw/${id}/z2m/bridge/state`, 'online');
    await eventually(async () => expect((await rowOf(id)).z2m_status).toBe('online'));
    await publish(`gw/${id}/z2m/bridge/state`, '{"state":"offline"}');
    await eventually(async () => expect((await rowOf(id)).z2m_status).toBe('offline'));
    await publish(`gw/${id}/z2m/bridge/state`, '{"state":"online"}');
    await eventually(async () => expect((await rowOf(id)).z2m_status).toBe('online'));
  });

  it('shows a gateway as online right after registering it when it spoke before', async () => {
    const issued = ca.issue();
    await publish(`gw/${issued.id}/bridge/connection`, '1', true);
    await publish(`gw/${issued.id}/z2m/bridge/state`, '{"state":"online"}', true);
    const memory = app.get<GatewayStatusMemory>(GATEWAY_STATUS_MEMORY);
    await eventually(() => expect(memory.recall(issued.id)?.z2m).toBe('online'));
    now = new Date();
    const gateway = await app
      .get(GatewaysService)
      .register(householdId, { name: 'Late Pi', certificate: issued.certificate });
    expect(gateway.bridgeStatus).toBe('online');
    expect(gateway.z2mStatus).toBe('online');
    expect(gateway.statusChangedAt).not.toBeNull();
  });

  it('leaves a revoked gateway unchanged', async () => {
    const id = randomGatewayId();
    await insertGateway(id, { revoked: true, bridge: 'offline' });
    await publish(`gw/${id}/bridge/connection`, '1');
    await publish(`gw/${id}/z2m/bridge/state`, 'online');
    await publish(`gw/${id}/z2m/lamp`, '{"state":"ON"}');
    await flush();
    expect(await rowOf(id)).toEqual({
      bridge_status: 'offline',
      z2m_status: 'unknown',
      status_changed_at: null,
      last_message_at: null,
    });
  });

  it('discards a message with an invalid gateway ID in the topic', async () => {
    await publish('gw/GW-BAD00001/bridge/connection', '1');
    await publish('gw/gw-short/bridge/connection', '1');
    await flush();
    const memory = app.get<GatewayStatusMemory>(GATEWAY_STATUS_MEMORY);
    expect(memory.recall('GW-BAD00001')).toBeUndefined();
    expect(memory.recall('gw-short')).toBeUndefined();
  });

  it('writes last_message_at for a message below the z2m prefix, at most once a minute', async () => {
    const id = randomGatewayId();
    await insertGateway(id);
    now = new Date(Date.now() + 10_000);
    const first = now;
    await publish(`gw/${id}/z2m/living_room_lamp`, '{"state":"ON"}');
    await eventually(async () => expect((await rowOf(id)).last_message_at).toEqual(first));
    now = new Date(first.getTime() + 61_000);
    await publish(`gw/${id}/z2m/living_room_lamp`, '{"state":"OFF"}');
    await eventually(async () => expect((await rowOf(id)).last_message_at).toEqual(now));
  });

  it('announces gateway.touched for the write and finds the gateway with its household', async () => {
    const id = randomGatewayId();
    await insertGateway(id);
    const touched: GatewayTouched[] = [];
    const listener = (event: GatewayTouched): void => void touched.push(event);
    app.get(GatewayEvents).on(GATEWAY_TOUCHED, listener);
    now = new Date(Date.now() + 10_000);
    await publish(`gw/${id}/z2m/living_room_lamp`, '{"state":"ON"}');
    await eventually(() => expect(touched).toEqual([{ gatewayId: id }]));
    app.get(GatewayEvents).off(GATEWAY_TOUCHED, listener);
    const found = await app.get(GatewaysService).find(id);
    expect(found?.householdId).toBe(householdId);
    expect(found?.gateway.id).toBe(id);
    expect(await app.get(GatewaysService).find(randomGatewayId())).toBeUndefined();
  });

  it('processes a status message after the broker restarted', async () => {
    const id = randomGatewayId();
    await insertGateway(id);
    await publish(`gw/${id}/bridge/connection`, '0');
    await eventually(async () => expect((await rowOf(id)).bridge_status).toBe('offline'));

    await broker.restart({ timeout: 5000 });

    // The consumer's client reconnects and subscribes again on its own; keep publishing until
    // the first message gets through, and give up after a fixed time.
    await eventually(async () => {
      publisher.publish(`gw/${id}/bridge/connection`, '1', { qos: 0 });
      expect((await rowOf(id)).bridge_status).toBe('online');
    }, 60_000);
  }, 90_000);
});
