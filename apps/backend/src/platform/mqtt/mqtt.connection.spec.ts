import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Callback = (error?: Error) => void;
interface Packet {
  topic: string;
  payload: Buffer;
  retain: boolean;
  qos: 0 | 1 | 2;
  properties?: { subscriptionIdentifier?: number | number[] };
}

/** Just enough of mqtt.js: the connection replaces `handleMessage`, as it does on the real client. */
class FakeClient extends EventEmitter {
  connected = true;
  readonly subscribe = vi.fn();
  readonly unsubscribe = vi.fn();
  readonly endAsync = vi.fn(() => Promise.resolve());
  handleMessage: (packet: Packet, callback: Callback) => void = (_packet, callback) => {
    callback();
  };
}

const mocks = vi.hoisted(() => ({
  client: undefined as FakeClient | undefined,
  options: undefined as Record<string, unknown> | undefined,
}));
vi.mock('mqtt', () => ({
  connect: (_url: string, options: Record<string, unknown>) => {
    mocks.options = options;
    return mocks.client;
  },
}));

const { MqttConnection } = await import('./mqtt.connection.js');

const settings = { url: 'mqtt://broker', username: 'u', password: 'p', clientId: 'c' };
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('MqttConnection acknowledgements', () => {
  let client: FakeClient;
  let errors: Error[];
  let connection: InstanceType<typeof MqttConnection>;

  /** What the broker would put on the copy for the subscription made last. */
  const idOf = (call: number): number => {
    const options = client.subscribe.mock.calls[call]?.[1] as {
      properties: { subscriptionIdentifier: number };
    };
    return options.properties.subscriptionIdentifier;
  };
  const deliver = (topic: string, id: number | undefined, qos: 0 | 1 = 1): Promise<void> =>
    new Promise((resolve, reject) => {
      client.handleMessage(
        {
          topic,
          payload: Buffer.from('p'),
          retain: false,
          qos,
          properties: id === undefined ? undefined : { subscriptionIdentifier: id },
        },
        (error) => {
          if (error) reject(error);
          else resolve();
        },
      );
    });

  beforeEach(() => {
    vi.useRealTimers();
    client = new FakeClient();
    mocks.client = client;
    errors = [];
    connection = new MqttConnection({ ...settings, onError: (error) => errors.push(error) });
  });

  it('subscribes with QoS 1 unless told otherwise, and with the QoS asked for', () => {
    connection.subscribe('a/#', () => undefined);
    connection.subscribe('b/#', () => undefined, { qos: 0 });
    expect(client.subscribe.mock.calls.map((call) => (call[1] as { qos: number }).qos)).toEqual([
      1, 0,
    ]);
  });

  it('acknowledges at once when the handler is not asked to gate it', async () => {
    let finish: () => void = () => undefined;
    connection.subscribe('a/#', () => new Promise<void>((resolve) => (finish = resolve)));
    const acked = vi.fn();
    void deliver('a/x', idOf(0)).then(acked);
    await settle();
    expect(acked).toHaveBeenCalledTimes(1);
    finish();
  });

  it('acknowledges only after the async handler resolved', async () => {
    let finish: () => void = () => undefined;
    const seen: string[] = [];
    connection.subscribe(
      'a/#',
      (topic) => {
        seen.push(topic);
        return new Promise<void>((resolve) => (finish = resolve));
      },
      { qos: 1, ackAfterHandler: true },
    );
    const acked = vi.fn();
    void deliver('a/x', idOf(0)).then(acked);
    await settle();
    expect(seen).toEqual(['a/x']);
    expect(acked).not.toHaveBeenCalled();

    finish();
    await settle();
    expect(acked).toHaveBeenCalledTimes(1);
  });

  it('acknowledges when the handler rejects, without leaking the reason', async () => {
    connection.subscribe('a/#', () => Promise.reject(new Error('secret payload')), {
      ackAfterHandler: true,
    });
    await deliver('a/x', idOf(0));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).not.toContain('secret');
  });

  it('acknowledges when the handler throws', async () => {
    connection.subscribe(
      'a/#',
      () => {
        throw new Error('secret payload');
      },
      { ackAfterHandler: true },
    );
    await deliver('a/x', idOf(0));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).not.toContain('secret');
  });

  it('waits for the gating handlers of the copy only, not for those of other filters', async () => {
    let finish: () => void = () => undefined;
    connection.subscribe('a/#', () => new Promise<void>((resolve) => (finish = resolve)), {
      ackAfterHandler: true,
    });
    const other = vi.fn();
    connection.subscribe('+/x', other);
    // The copy for the second filter: the slow handler of the first has nothing to do with it.
    await deliver('a/x', idOf(1));
    expect(other).toHaveBeenCalledTimes(1);
    finish();
  });

  it('does not acknowledge before every gating handler of the copy is done', async () => {
    const finishers: (() => void)[] = [];
    for (let index = 0; index < 2; index += 1) {
      connection.subscribe('a/#', () => new Promise<void>((resolve) => finishers.push(resolve)), {
        ackAfterHandler: true,
      });
    }
    const acked = vi.fn();
    void deliver('a/x', idOf(0)).then(acked);
    await settle();
    finishers[0]?.();
    await settle();
    expect(acked).not.toHaveBeenCalled();
    finishers[1]?.();
    await settle();
    expect(acked).toHaveBeenCalledTimes(1);
  });

  it('acknowledges a message that no subscription is left for', async () => {
    const unsubscribe = connection.subscribe('a/#', vi.fn(), { ackAfterHandler: true });
    const id = idOf(0);
    unsubscribe();
    await deliver('a/x', id);
  });

  it('matches by filter when the copy carries no subscription identifier', async () => {
    const handler = vi.fn();
    connection.subscribe('a/+', handler, { ackAfterHandler: true });
    connection.subscribe('b/+', vi.fn());
    await deliver('a/x', undefined);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('acknowledges a QoS 0 delivery too, after the handler', async () => {
    let finish: () => void = () => undefined;
    connection.subscribe('a/#', () => new Promise<void>((resolve) => (finish = resolve)), {
      qos: 0,
      ackAfterHandler: true,
    });
    const acked = vi.fn();
    void deliver('a/x', idOf(0), 0).then(acked);
    await settle();
    expect(acked).not.toHaveBeenCalled();
    finish();
    await settle();
    expect(acked).toHaveBeenCalledTimes(1);
  });

  it('connects with the given client id and a persistent MQTT 5 session', () => {
    expect(mocks.options).toMatchObject({
      clientId: 'c',
      protocolVersion: 5,
      clean: false,
      properties: { sessionExpiryInterval: 86_400 },
    });
  });

  describe('subscription identifiers across restarts', () => {
    const idsOf = (filters: string[]): Map<string, number> => {
      const next = new FakeClient();
      mocks.client = next;
      const fresh = new MqttConnection(settings);
      for (const filter of filters) fresh.subscribe(filter, () => undefined);
      return new Map(
        next.subscribe.mock.calls.map((call) => [
          call[0] as string,
          (call[1] as { properties: { subscriptionIdentifier: number } }).properties
            .subscriptionIdentifier,
        ]),
      );
    };

    it('gives a filter the same identifier in every process, whatever the order', () => {
      const first = idsOf(['gw/a/z2m/#', 'gw/b/z2m/#', 'gw/+/bridge/connection']);
      const second = idsOf(['gw/+/bridge/connection', 'gw/b/z2m/#']);
      expect(second.get('gw/b/z2m/#')).toBe(first.get('gw/b/z2m/#'));
      expect(second.get('gw/+/bridge/connection')).toBe(first.get('gw/+/bridge/connection'));
      expect(new Set(first.values()).size).toBe(3);
      for (const id of first.values()) {
        expect(id).toBeGreaterThanOrEqual(1);
        expect(id).toBeLessThanOrEqual(268_435_455);
      }
    });

    it('hands a copy queued by an earlier process to the handler of the same filter', async () => {
      const first = idsOf(['gw/a/z2m/#']).get('gw/a/z2m/#');
      const handler = vi.fn();
      connection.subscribe('gw/a/z2m/#', handler, { ackAfterHandler: true });
      await deliver('gw/a/z2m/x', first);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('acknowledges and drops a copy of a subscription this process does not have', async () => {
      const handler = vi.fn();
      connection.subscribe('gw/a/z2m/#', handler, { ackAfterHandler: true });
      await deliver('gw/b/z2m/x', 12_345);
      expect(handler).not.toHaveBeenCalled();
    });

    it('never gives a handler a copy of a topic that its filter does not match', async () => {
      const handler = vi.fn();
      connection.subscribe('gw/a/z2m/#', handler);
      // A stale identifier of another filter that happens to equal this filter's identifier.
      await deliver('gw/b/z2m/x', idOf(0));
      expect(handler).not.toHaveBeenCalled();
    });

    it('delivers by topic a copy with an identifier of no subscription when a filter matches', async () => {
      const handler = vi.fn();
      connection.subscribe('gw/+/z2m/#', handler);
      await deliver('gw/b/z2m/x', 12_345);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('acknowledgement time limit', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('acknowledges a gated handler that is not done after 30 s and says so without details', async () => {
      connection.subscribe('gw/a/z2m/#', () => new Promise<void>(() => undefined), {
        ackAfterHandler: true,
      });
      const acked = vi.fn();
      void deliver('gw/a/z2m/secret-device', idOf(0)).then(acked);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(acked).not.toHaveBeenCalled();
      expect(errors).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(acked).toHaveBeenCalledTimes(1);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain('gw/a/z2m/#');
      expect(errors[0]?.message).not.toContain('secret-device');
    });

    it('goes on with the next message and acknowledges once only', async () => {
      const finishers: (() => void)[] = [];
      const seen: string[] = [];
      connection.subscribe(
        'a/#',
        (topic) => {
          seen.push(topic);
          return new Promise<void>((resolve) => finishers.push(resolve));
        },
        { ackAfterHandler: true },
      );
      const first = vi.fn();
      const second = vi.fn();
      void deliver('a/1', idOf(0)).then(first);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(first).toHaveBeenCalledTimes(1);
      void deliver('a/2', idOf(0)).then(second);
      await vi.advanceTimersByTimeAsync(0);
      expect(seen).toEqual(['a/1', 'a/2']);
      finishers[0]?.();
      finishers[1]?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
      expect(errors).toHaveLength(1);
    });

    it('does not time out a handler that is done in time', async () => {
      connection.subscribe('a/#', () => Promise.resolve(), { ackAfterHandler: true });
      await deliver('a/x', idOf(0));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(errors).toHaveLength(0);
    });

    it('does not acknowledge on timeout once the connection is closed', async () => {
      connection.subscribe('a/#', () => new Promise<void>(() => undefined), {
        ackAfterHandler: true,
      });
      const acked = vi.fn();
      void deliver('a/x', idOf(0)).then(acked);
      await connection.close();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(acked).not.toHaveBeenCalled();
    });
  });

  describe('keeping the subscription for the next process', () => {
    it('stops delivering without unsubscribing at the broker', () => {
      const handler = vi.fn();
      const unsubscribe = connection.subscribe('a/#', handler);
      unsubscribe({ keepSession: true });
      expect(client.unsubscribe).not.toHaveBeenCalled();
      void deliver('a/x', idOf(0));
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not acknowledge what arrives for it, so that the broker delivers it again', async () => {
      const unsubscribe = connection.subscribe('a/#', vi.fn(), { ackAfterHandler: true });
      unsubscribe({ keepSession: true });
      const acked = vi.fn();
      void deliver('a/x', idOf(0)).then(acked);
      await settle();
      expect(acked).not.toHaveBeenCalled();
    });

    it('still unsubscribes at the broker on a plain unsubscribe', () => {
      connection.subscribe('a/#', vi.fn())();
      expect(client.unsubscribe).toHaveBeenCalledWith('a/#');
    });
  });

  describe('replayed messages before the subscriptions are made', () => {
    const gated = (): InstanceType<typeof MqttConnection> => {
      client = new FakeClient();
      mocks.client = client;
      return new MqttConnection({
        ...settings,
        awaitSubscriptions: true,
        onError: (error) => errors.push(error),
      });
    };
    /** The identifier a filter gets, as a process that has subscribed to it would use. */
    const idFor = (filter: string): number => {
      const other = new FakeClient();
      mocks.client = other;
      new MqttConnection(settings).subscribe(filter, () => undefined);
      const options = other.subscribe.mock.calls[0]?.[1] as {
        properties: { subscriptionIdentifier: number };
      };
      return options.properties.subscriptionIdentifier;
    };

    it('holds a copy of a subscription that is not made yet, and hands it over when it is', async () => {
      const id = idFor('gw/a/z2m/#');
      const gate = gated();
      const acked = vi.fn();
      void deliver('gw/a/z2m/x', id).then(acked);
      await settle();
      expect(acked).not.toHaveBeenCalled();

      const handler = vi.fn();
      gate.subscribe('gw/a/z2m/#', handler, { ackAfterHandler: true });
      await settle();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(acked).toHaveBeenCalledTimes(1);
    });

    it('does not give a held copy to another filter that matches the topic', async () => {
      const id = idFor('gw/a/z2m/#');
      const gate = gated();
      const wide = vi.fn();
      gate.subscribe('gw/+/z2m/#', wide);
      const acked = vi.fn();
      void deliver('gw/a/z2m/x', id).then(acked);
      await settle();
      expect(wide).not.toHaveBeenCalled();
      expect(acked).not.toHaveBeenCalled();
    });

    it('acknowledges and drops what no subscription is made for once the application is ready', async () => {
      const id = idFor('gw/revoked/z2m/#');
      const gate = gated();
      const acked = vi.fn();
      void deliver('gw/revoked/z2m/x', id).then(acked);
      await settle();
      expect(acked).not.toHaveBeenCalled();

      gate.markSubscriptionsComplete();
      await settle();
      expect(acked).toHaveBeenCalledTimes(1);

      // From now on at once.
      await deliver('gw/revoked/z2m/y', id);
    });

    it('still delivers by identifier while the gate is closed', async () => {
      const gate = gated();
      const handler = vi.fn();
      gate.subscribe('gw/a/z2m/#', handler);
      await deliver('gw/a/z2m/x', idOf(0));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not hold anything unless asked to', async () => {
      await deliver('gw/a/z2m/x', 4711);
    });
  });

  describe('identifier collisions', () => {
    // Two filters whose identifiers are the same number (found by search): the second gets the next.
    const first = 'gw/c9755/z2m/#';
    const second = 'gw/c28751/z2m/#';

    it('gives colliding filters different identifiers and warns once per filter', () => {
      connection.subscribe(first, () => undefined);
      connection.subscribe(second, () => undefined);
      connection.subscribe(second, () => undefined);
      expect(idOf(1)).not.toBe(idOf(0));
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain('identifier');
      expect(errors[0]?.message).toContain(second);
    });

    it('delivers a copy whose identifier belongs to another filter by topic instead of dropping it', async () => {
      const handler = vi.fn();
      connection.subscribe(first, vi.fn());
      connection.subscribe(second, handler, { ackAfterHandler: true });
      // Queued by an earlier process, where the second filter had the first one's identifier.
      await deliver('gw/c28751/z2m/x', idOf(0));
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('waits for the gating handler of such a copy', async () => {
      let finish: () => void = () => undefined;
      connection.subscribe(first, vi.fn());
      connection.subscribe(second, () => new Promise<void>((resolve) => (finish = resolve)), {
        ackAfterHandler: true,
      });
      const acked = vi.fn();
      void deliver('gw/c28751/z2m/x', idOf(0)).then(acked);
      await settle();
      expect(acked).not.toHaveBeenCalled();
      finish();
      await settle();
      expect(acked).toHaveBeenCalledTimes(1);
    });
  });
});
