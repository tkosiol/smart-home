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

const mocks = vi.hoisted(() => ({ client: undefined as FakeClient | undefined }));
vi.mock('mqtt', () => ({ connect: () => mocks.client }));

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
});
