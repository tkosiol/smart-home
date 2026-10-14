import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseConfig } from './config.js';
import { loadFixtureDevices } from './fixtures.js';
import { clientOptions, Gateway } from './gateway.js';

const config = parseConfig({
  MQTT_URL: 'mqtt://broker:1883',
  MQTT_USERNAME: 'smart-simulator',
  MQTT_PASSWORD: 'secret-value',
  GATEWAY_ID: 'gw-abcd1234',
  INTERVAL_SECONDS: '60',
  SEED: '1',
});

interface Published {
  topic: string;
  payload: string;
  qos: number;
  retain: boolean;
}

class FakeClient extends EventEmitter {
  published: Published[] = [];
  subscribed: string[] = [];
  ended = false;
  publishAsync = vi.fn(
    (topic: string, payload: string, options: { qos: 0 | 1; retain: boolean }) => {
      this.published.push({ topic, payload, ...options });
      return Promise.resolve();
    },
  );
  subscribeAsync = vi.fn((topic: string) => {
    this.subscribed.push(topic);
    return Promise.resolve();
  });
  endAsync = vi.fn(() => {
    this.ended = true;
    return Promise.resolve();
  });
}

const P = 'gw/gw-abcd1234/';

describe('clientOptions', () => {
  it('sets the retained last will 0 on the connection topic with QoS 1', () => {
    const options = clientOptions(config);
    expect(options.will).toEqual({
      topic: `${P}bridge/connection`,
      payload: Buffer.from('0'),
      qos: 1,
      retain: true,
    });
    expect(options.username).toBe('smart-simulator');
    expect(options.clientId).not.toBe('gw-abcd1234');
  });
});

describe('Gateway', () => {
  let client: FakeClient;
  let connectOptions: unknown;
  let gateway: Gateway;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'));
    client = new FakeClient();
    gateway = new Gateway(config, loadFixtureDevices(), {
      connect: (_url, options) => {
        connectOptions = options;
        return client;
      },
      log: () => undefined,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const connect = async (): Promise<void> => {
    client.emit('connect');
    await vi.advanceTimersByTimeAsync(0);
  };
  const find = (topic: string): Published[] => client.published.filter((m) => m.topic === topic);

  it('connects with the last will', () => {
    expect(connectOptions).toMatchObject({
      will: { topic: `${P}bridge/connection`, payload: Buffer.from('0'), qos: 1, retain: true },
    });
  });

  it('announces itself on connect: connection 1, bridge state, device list and availability, all retained', async () => {
    await connect();
    expect(client.published[0]).toEqual({
      topic: `${P}bridge/connection`,
      payload: '1',
      qos: 1,
      retain: true,
    });
    expect(find(`${P}z2m/bridge/state`)).toEqual([
      { topic: `${P}z2m/bridge/state`, payload: '{"state":"online"}', qos: 1, retain: true },
    ]);
    const [devices] = find(`${P}z2m/bridge/devices`);
    expect(devices?.retain).toBe(true);
    const list = JSON.parse(devices?.payload ?? '[]') as { friendly_name: string }[];
    expect(list.map((d) => d.friendly_name)).toContain('Lampe');
    expect(find(`${P}z2m/Pflanze 1/availability`)).toHaveLength(1);
    expect(find(`${P}z2m/Pflanze 1/availability`)[0]).toMatchObject({
      payload: '{"state":"online"}',
      retain: true,
    });
    expect(client.subscribed).toEqual([`${P}z2m/+/set`]);
  });

  it('reports the devices at once and then every interval', async () => {
    await connect();
    const first = find(`${P}z2m/Pflanze 2`);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ retain: false });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(find(`${P}z2m/Pflanze 2`)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(find(`${P}z2m/Pflanze 2`)).toHaveLength(4);
  });

  it('does not start a second timer when the connection comes back', async () => {
    await connect();
    await connect();
    const before = find(`${P}z2m/Pflanze 2`).length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(find(`${P}z2m/Pflanze 2`)).toHaveLength(before + 1);
  });

  it('answers a set message for the lamp with the new state', async () => {
    await connect();
    client.emit('message', `${P}z2m/Lampe/set`, Buffer.from('{"state":"ON","brightness":100}'));
    await vi.advanceTimersByTimeAsync(0);
    const states = find(`${P}z2m/Lampe`);
    expect(JSON.parse(states.at(-1)?.payload ?? '{}')).toMatchObject({
      state: 'ON',
      brightness: 100,
    });
  });

  it('ignores a set message that is not JSON or not for a lamp', async () => {
    await connect();
    const before = client.published.length;
    client.emit('message', `${P}z2m/Lampe/set`, Buffer.from('not json'));
    client.emit('message', `${P}z2m/Pflanze 1/set`, Buffer.from('{"state":"ON"}'));
    client.emit('message', `${P}z2m/bridge/request/x`, Buffer.from('{}'));
    await vi.advanceTimersByTimeAsync(0);
    expect(client.published).toHaveLength(before);
  });

  it('says 0, stops reporting and disconnects on stop', async () => {
    await connect();
    await gateway.stop();
    expect(client.published.at(-1)).toEqual({
      topic: `${P}bridge/connection`,
      payload: '0',
      qos: 1,
      retain: true,
    });
    expect(client.ended).toBe(true);
    const count = client.published.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(client.published).toHaveLength(count);
  });

  it('writes only below its own gateway prefix', async () => {
    await connect();
    await vi.advanceTimersByTimeAsync(120_000);
    for (const message of client.published) expect(message.topic.startsWith(P)).toBe(true);
  });
});
