import { connect as connectClient, type MqttClient } from 'mqtt';
import { inject, vi } from 'vitest';
import { MqttConnection, MqttHealth } from '../src/platform/mqtt/index.js';

const env = inject('testEnv');

function connect(password: string, errors: Error[] = []): MqttConnection {
  return new MqttConnection({
    url: env.MQTT_URL,
    username: env.MQTT_USERNAME,
    password,
    clientId: `test-${Math.random().toString(16).slice(2)}`,
    onError: (error) => errors.push(error),
  });
}

/** A plain client that publishes, as a gateway would. */
const writer = (): MqttClient =>
  connectClient(env.MQTT_URL, {
    username: env.MQTT_USERNAME,
    password: env.MQTT_PASSWORD,
    clientId: `test-writer-${Math.random().toString(16).slice(2)}`,
  });

describe('MqttConnection', () => {
  it('connects with valid credentials and reports up', async () => {
    const connection = connect(env.MQTT_PASSWORD);
    try {
      expect(await connection.waitUntilConnected(5000)).toBe(true);
      expect(new MqttHealth(connection).check()).toBe('up');
    } finally {
      await connection.close();
    }
  });

  it('stays down with a wrong password and reports the error instead of crashing', async () => {
    const errors: Error[] = [];
    const connection = connect('wrong-password', errors);
    try {
      expect(await connection.waitUntilConnected(3000)).toBe(false);
      expect(new MqttHealth(connection).check()).toBe('down');
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      await connection.close();
    }
  });

  describe('subscribe', () => {
    const topic = (): string => `gw/test-${Math.random().toString(16).slice(2)}/x`;

    it('delivers matching messages and stops after unsubscribing', async () => {
      const reader = connect(env.MQTT_PASSWORD);
      const source = writer();
      try {
        await reader.waitUntilConnected(5000);
        const base = topic();
        const seen: string[] = [];
        const unsubscribe = reader.subscribe(`${base}/#`, (received, payload, retained) => {
          seen.push(`${received}=${payload.toString()}:${String(retained)}`);
        });
        await vi.waitFor(async () => {
          await source.publishAsync(`${base}/a`, 'one', { qos: 1 });
          expect(seen).toContain(`${base}/a=one:false`);
        });
        unsubscribe();
        const count = seen.length;
        await source.publishAsync(`${base}/a`, 'two', { qos: 1 });
        await source.publishAsync(`${base}/a`, 'three', { qos: 1 });
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(seen.length).toBe(count);
      } finally {
        await reader.close();
        await source.endAsync(true);
      }
    });

    it('delivers a message once to each handler although the filters overlap', async () => {
      const reader = connect(env.MQTT_PASSWORD);
      const source = writer();
      try {
        await reader.waitUntilConnected(5000);
        const base = topic();
        const wide: string[] = [];
        const narrow: string[] = [];
        reader.subscribe(`${base.split('/')[0]}/+/x/#`, (_topic, payload) => {
          wide.push(payload.toString());
        });
        reader.subscribe(`${base}/#`, (_topic, payload) => {
          narrow.push(payload.toString());
        });
        await vi.waitFor(async () => {
          await source.publishAsync(`${base}/probe`, 'probe', { qos: 1 });
          expect(narrow).toContain('probe');
        });
        await source.publishAsync(`${base}/a`, 'one', { qos: 1 });
        await source.publishAsync(`${base}/b`, 'sentinel', { qos: 1 });
        await vi.waitFor(() => expect(narrow).toContain('sentinel'));
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(narrow.filter((payload) => payload === 'one')).toHaveLength(1);
        expect(wide.filter((payload) => payload === 'one')).toHaveLength(1);
      } finally {
        await reader.close();
        await source.endAsync(true);
      }
    });

    it('calls two handlers of the same filter once each', async () => {
      const reader = connect(env.MQTT_PASSWORD);
      const source = writer();
      try {
        await reader.waitUntilConnected(5000);
        const base = topic();
        const first: string[] = [];
        const second: string[] = [];
        reader.subscribe(`${base}/#`, (_topic, payload) => {
          first.push(payload.toString());
        });
        reader.subscribe(`${base}/#`, (_topic, payload) => {
          second.push(payload.toString());
        });
        await vi.waitFor(async () => {
          await source.publishAsync(`${base}/probe`, 'probe', { qos: 1 });
          expect(second).toContain('probe');
        });
        await source.publishAsync(`${base}/a`, 'one', { qos: 1 });
        await source.publishAsync(`${base}/b`, 'sentinel', { qos: 1 });
        await vi.waitFor(() => expect(second).toContain('sentinel'));
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(first.filter((payload) => payload === 'one')).toHaveLength(1);
        expect(second.filter((payload) => payload === 'one')).toHaveLength(1);
      } finally {
        await reader.close();
        await source.endAsync(true);
      }
    });

    it('delivers every message of a burst to a slow handler that gates the acknowledgement', async () => {
      const reader = connect(env.MQTT_PASSWORD);
      const source = writer();
      try {
        await reader.waitUntilConnected(5000);
        const base = topic();
        const seen: number[] = [];
        reader.subscribe(
          `${base}/#`,
          async (_topic, payload) => {
            await new Promise((resolve) => setTimeout(resolve, 2));
            seen.push(Number(payload.toString()));
            if (payload.toString() === '7') throw new Error('one bad message');
          },
          { qos: 1, ackAfterHandler: true },
        );
        await vi.waitFor(async () => {
          await source.publishAsync(`${base}/probe`, '-1', { qos: 1 });
          expect(seen).toContain(-1);
        });
        const total = 1500;
        await Promise.all(
          Array.from({ length: total }, (_, index) =>
            source.publishAsync(`${base}/a`, String(index), { qos: 1 }),
          ),
        );
        const bursts = (): number[] => seen.filter((value) => value >= 0);
        await vi.waitFor(() => expect(bursts()).toHaveLength(total), { timeout: 20_000 });
        expect(bursts()).toEqual(Array.from({ length: total }, (_, index) => index));
        expect(reader.isConnected()).toBe(true);
      } finally {
        await reader.close();
        await source.endAsync(true);
      }
    });

    it('keeps working when a handler throws, without leaking the reason', async () => {
      const errors: Error[] = [];
      const reader = connect(env.MQTT_PASSWORD, errors);
      const source = writer();
      try {
        await reader.waitUntilConnected(5000);
        const base = topic();
        const seen: string[] = [];
        reader.subscribe(`${base}/#`, (_topic, payload) => {
          seen.push(payload.toString());
          throw new Error(`secret ${payload.toString()}`);
        });
        reader.subscribe(`${base}/#`, (_topic, payload) => {
          seen.push(`second:${payload.toString()}`);
        });
        await vi.waitFor(async () => {
          await source.publishAsync(`${base}/a`, 'p1', { qos: 1 });
          expect(seen).toContain('second:p1');
        });
        expect(errors.length).toBeGreaterThan(0);
        expect(errors.map((error) => error.message).join()).not.toContain('secret');
        expect(reader.isConnected()).toBe(true);
      } finally {
        await reader.close();
        await source.endAsync(true);
      }
    });
  });
});
