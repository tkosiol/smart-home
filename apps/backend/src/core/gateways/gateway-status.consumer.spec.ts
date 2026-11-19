import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MqttConnection, MqttMessageHandler, Unsubscribe } from '../../platform/mqtt/index.js';
import { AdapterRegistry, type GatewayAdapter } from '../adapters/index.js';
import {
  GATEWAY_STATUS_CHANGED,
  GatewayEvents,
  type GatewayStatusChanged,
} from './gateway-events.js';
import { StatusMemory } from './gateway-status-memory.js';
import { GatewayStatusConsumer } from './gateway-status.consumer.js';
import type { GatewaysRepository } from './gateways.repository.js';

const T0 = new Date('2026-10-14T12:00:00Z');
const ID = 'gw-a1b2c3d4';
const OTHER = 'gw-e5f6a7b8';

/** Reads `online`/`offline` or `{"state":"…"}` like the real adapter does, and nothing else. */
function readState(payload: Buffer): 'online' | 'offline' | undefined {
  if (payload.length > 1024) return undefined;
  const text = payload.toString('utf8').trim();
  if (text === 'online' || text === 'offline') return text;
  if (!text.startsWith('{')) return undefined;
  try {
    const state = (JSON.parse(text) as { state?: unknown }).state;
    return state === 'online' || state === 'offline' ? state : undefined;
  } catch {
    return undefined;
  }
}

const adapterOf = (kind: string, serviceStatusTopic: string): GatewayAdapter =>
  ({ kind, serviceStatusTopic, parseServiceStatus: readState }) as unknown as GatewayAdapter;

type Outcome = 'changed' | 'unchanged' | 'ignored';

/** Like a broker: delivers a message to the handlers whose filter matches. */
class FakeMqtt {
  readonly handlers: { filter: string; handler: MqttMessageHandler }[] = [];
  /** What was ended, and whether with `keepSession` (the broker's subscription stays). */
  readonly unsubscribed: { filter: string; keepSession: boolean }[] = [];

  subscribe(filter: string, handler: MqttMessageHandler): Unsubscribe {
    const entry = { filter, handler };
    this.handlers.push(entry);
    return (options) => {
      this.handlers.splice(this.handlers.indexOf(entry), 1);
      this.unsubscribed.push({ filter, keepSession: options?.keepSession === true });
    };
  }

  publish(topic: string, payload: string, retained = false): void {
    const levels = topic.split('/');
    for (const { filter, handler } of [...this.handlers]) {
      const pattern = filter.split('/');
      const hash = pattern.at(-1) === '#';
      const fixed = hash ? pattern.slice(0, -1) : pattern;
      const matches =
        (hash ? levels.length >= fixed.length : levels.length === fixed.length) &&
        fixed.every((level, index) => level === '+' || level === levels[index]);
      if (matches) void handler(topic, Buffer.from(payload), retained);
    }
  }
}

describe('GatewayStatusConsumer', () => {
  let now: Date;
  let mqtt: FakeMqtt;
  let memory: StatusMemory;
  let events: GatewayEvents;
  let consumer: GatewayStatusConsumer;
  let applyStatus: ReturnType<typeof vi.fn<GatewaysRepository['applyStatus']>>;
  const changes: GatewayStatusChanged[] = [];
  const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const logged = (): string => [...log.mock.calls, ...warn.mock.calls].map(String).join('\n');
  const settle = (): Promise<void> => consumer.idle();

  beforeEach(() => {
    now = T0;
    mqtt = new FakeMqtt();
    memory = new StatusMemory();
    events = new GatewayEvents();
    changes.length = 0;
    events.on(GATEWAY_STATUS_CHANGED, (event: GatewayStatusChanged) => changes.push(event));
    applyStatus = vi.fn<GatewaysRepository['applyStatus']>(() =>
      Promise.resolve('changed' as Outcome),
    );
    consumer = new GatewayStatusConsumer(
      { applyStatus } as unknown as GatewaysRepository,
      memory,
      events,
      new AdapterRegistry([adapterOf('z2m', 'bridge/state'), adapterOf('xx', 'status')]),
      mqtt as unknown as MqttConnection,
      () => now,
    );
    consumer.onModuleInit();
  });

  afterEach(() => {
    log.mockClear();
    warn.mockClear();
  });

  it('subscribes to the connection topic and the status topic of each adapter, not a whole subtree, and unsubscribes on shutdown', () => {
    expect(mqtt.handlers.map(({ filter }) => filter).sort()).toEqual([
      'gw/+/bridge/connection',
      'gw/+/xx/status',
      'gw/+/z2m/bridge/state',
    ]);
    consumer.onModuleDestroy();
    expect(mqtt.handlers).toEqual([]);
  });

  it('only lets go of the handlers on shutdown: the broker keeps the shared session subscribed', () => {
    // The session at the broker outlives the process (and a second process may share it): a plain
    // unsubscribe would end the subscriptions for whoever is connected next.
    consumer.onModuleDestroy();
    expect(mqtt.unsubscribed).toHaveLength(3);
    expect(mqtt.unsubscribed.every(({ keepSession }) => keepSession)).toBe(true);
  });

  describe('bridge/connection', () => {
    it('maps 1 to online and 0 to offline', async () => {
      mqtt.publish(`gw/${ID}/bridge/connection`, '1', true);
      mqtt.publish(`gw/${ID}/bridge/connection`, '0\n');
      await settle();
      expect(applyStatus.mock.calls.map(([id, kind, status]) => [id, kind, status])).toEqual([
        [ID, 'bridge', 'online'],
        [ID, 'bridge', 'offline'],
      ]);
    });

    it.each(['', '2', 'online', 'true', '{"state":"online"}', '11'])(
      'ignores the value %j',
      async (value) => {
        mqtt.publish(`gw/${ID}/bridge/connection`, value);
        await settle();
        expect(applyStatus).not.toHaveBeenCalled();
        expect(memory.recall(ID)).toBeUndefined();
      },
    );
  });

  describe('z2m/bridge/state', () => {
    it.each([
      ['online', 'online'],
      ['offline', 'offline'],
      [' online\n', 'online'],
      ['{"state":"offline"}', 'offline'],
      ['{"state": "online", "extra": 1}', 'online'],
    ])('reads %j as %s', async (payload, status) => {
      mqtt.publish(`gw/${ID}/z2m/bridge/state`, payload, true);
      await settle();
      expect(applyStatus).toHaveBeenCalledWith(ID, 'service', status, T0, 'z2m');
    });

    it.each([
      '',
      'unknown',
      'ONLINE',
      '{"state":"unknown"}',
      '{"state":1}',
      '{"other":"online"}',
      '[]',
      '"online"',
      '{broken',
      `{"state":"online","padding":"${'x'.repeat(2000)}"}`,
    ])('ignores %#', async (payload) => {
      mqtt.publish(`gw/${ID}/z2m/bridge/state`, payload);
      await settle();
      expect(applyStatus).not.toHaveBeenCalled();
    });
  });

  describe('the status of another adapter', () => {
    it('is read with the parser of that adapter and applied for its kind', async () => {
      mqtt.publish(`gw/${ID}/xx/status`, '{"state":"offline"}', true);
      await settle();
      expect(applyStatus).toHaveBeenCalledWith(ID, 'service', 'offline', T0, 'xx');
      expect(memory.recall(ID)).toEqual({
        service: 'offline',
        serviceKind: 'xx',
        at: T0,
      });
    });

    it('is ignored, and logged once, for a gateway of another kind', async () => {
      // The repository only applies it where `kind` matches; here the gateway is a z2m one.
      applyStatus.mockResolvedValue('ignored');
      mqtt.publish(`gw/${ID}/xx/status`, 'online');
      mqtt.publish(`gw/${ID}/xx/status`, 'offline');
      await settle();
      expect(changes).toEqual([]);
      expect([...log.mock.calls, ...warn.mock.calls]).toHaveLength(1);
    });

    it('does not take the z2m topic of a gateway for the other adapter', async () => {
      mqtt.publish(`gw/${ID}/xx/bridge/state`, 'online');
      await settle();
      expect(applyStatus).not.toHaveBeenCalled();
    });
  });

  it('discards messages whose topic carries an invalid gateway ID', async () => {
    for (const bad of ['GW-A1B2C3D4', 'gw-a1b2c3d', 'gw-a1b2c3d45', 'x', '..', 'gw-a1b2c3d4%00']) {
      mqtt.publish(`gw/${bad}/bridge/connection`, '1');
      mqtt.publish(`gw/${bad}/z2m/bridge/state`, 'online');
    }
    await settle();
    expect(applyStatus).not.toHaveBeenCalled();
    expect(logged()).toBe('');
  });

  describe('storing the status', () => {
    it('writes the clock time and emits the event only when the status changed', async () => {
      applyStatus.mockResolvedValueOnce('changed').mockResolvedValueOnce('unchanged');
      mqtt.publish(`gw/${ID}/bridge/connection`, '1');
      mqtt.publish(`gw/${ID}/bridge/connection`, '1');
      await settle();
      expect(changes).toEqual([{ gatewayId: ID, kind: 'bridge', status: 'online', at: T0 }]);
    });

    it('remembers the status of gateways that are not registered, with the time it changed', async () => {
      applyStatus.mockResolvedValue('ignored');
      mqtt.publish(`gw/${ID}/bridge/connection`, '1');
      now = new Date(T0.getTime() + 5000);
      mqtt.publish(`gw/${ID}/z2m/bridge/state`, '{"state":"online"}');
      now = new Date(T0.getTime() + 9000);
      mqtt.publish(`gw/${ID}/z2m/bridge/state`, 'online');
      await settle();
      expect(memory.recall(ID)).toEqual({
        bridge: 'online',
        service: 'online',
        serviceKind: 'z2m',
        at: new Date(T0.getTime() + 5000),
      });
      expect(changes).toEqual([]);
    });

    it('remembers the status of registered gateways as well', async () => {
      mqtt.publish(`gw/${ID}/bridge/connection`, '0');
      await settle();
      expect(memory.recall(ID)?.bridge).toBe('offline');
    });
  });

  describe('unknown and revoked gateways', () => {
    it('are logged at most once an hour per ID, without payload', async () => {
      applyStatus.mockResolvedValue('ignored');
      const secret = 'payload-secret-7731';
      mqtt.publish(`gw/${ID}/bridge/connection`, '1');
      mqtt.publish(`gw/${ID}/z2m/bridge/state`, `online`);
      mqtt.publish(`gw/${OTHER}/bridge/connection`, '1');
      await settle();
      const entries = [...log.mock.calls, ...warn.mock.calls].map(String);
      expect(entries).toHaveLength(2);
      expect(entries.filter((entry) => entry.includes(ID))).toHaveLength(1);
      expect(entries.filter((entry) => entry.includes(OTHER))).toHaveLength(1);
      expect(logged()).not.toContain(secret);
      now = new Date(T0.getTime() + 3_600_000);
      mqtt.publish(`gw/${ID}/bridge/connection`, '0');
      await settle();
      expect([...log.mock.calls, ...warn.mock.calls]).toHaveLength(3);
    });
  });

  describe('failures', () => {
    it('never stop the consumer and never log the reason or the payload', async () => {
      const secret = 'payload-secret-9902';
      applyStatus.mockRejectedValueOnce(new Error(`params: ${secret}`));
      mqtt.publish(`gw/${ID}/bridge/connection`, '1');
      await settle();
      mqtt.publish(`gw/${OTHER}/bridge/connection`, '1');
      await settle();
      expect(applyStatus).toHaveBeenLastCalledWith(OTHER, 'bridge', 'online', T0, undefined);
      expect(logged()).not.toContain(secret);
      expect(warn).toHaveBeenCalled();
    });

    it('survive a listener of the event that throws', async () => {
      events.on(GATEWAY_STATUS_CHANGED, () => {
        throw new Error('listener failed');
      });
      mqtt.publish(`gw/${ID}/bridge/connection`, '1');
      mqtt.publish(`gw/${OTHER}/bridge/connection`, '0');
      await settle();
      expect(applyStatus).toHaveBeenCalledTimes(2);
    });
  });

  it('processes messages one after the other, in the order they arrived', async () => {
    const order: string[] = [];
    applyStatus.mockImplementation(async (_id, _kind, status) => {
      await new Promise((resolve) => setTimeout(resolve, status === 'online' ? 20 : 0));
      order.push(status);
      return 'changed';
    });
    mqtt.publish(`gw/${ID}/bridge/connection`, '1');
    mqtt.publish(`gw/${ID}/bridge/connection`, '0');
    await settle();
    expect(order).toEqual(['online', 'offline']);
  });
});
