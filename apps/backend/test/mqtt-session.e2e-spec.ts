import { connect as connectClient, type MqttClient } from 'mqtt';
import { inject, vi } from 'vitest';
import { MqttConnection } from '../src/platform/mqtt/index.js';

const env = inject('testEnv');
const random = (): string => Math.random().toString(16).slice(2);

function app(clientId: string, errors: Error[] = [], awaitSubscriptions = false): MqttConnection {
  return new MqttConnection({
    awaitSubscriptions,
    url: env.MQTT_URL,
    username: env.MQTT_USERNAME,
    password: env.MQTT_PASSWORD,
    clientId,
    onError: (error) => errors.push(error),
  });
}

/** A plain client that publishes, as a gateway would. */
const writer = (): MqttClient =>
  connectClient(env.MQTT_URL, {
    username: env.MQTT_USERNAME,
    password: env.MQTT_PASSWORD,
    clientId: `test-writer-${random()}`,
  });

/** Resolves once the broker has the subscription (a message published after it is queued). */
async function subscribed(connection: MqttConnection, source: MqttClient, base: string) {
  const seen: string[] = [];
  const unsubscribe = connection.subscribe(`${base}/#`, (_topic, payload) => {
    seen.push(payload.toString());
  });
  await vi.waitFor(async () => {
    await source.publishAsync(`${base}/probe`, 'probe', { qos: 1 });
    expect(seen).toContain('probe');
  });
  return { seen, unsubscribe };
}

describe('MqttConnection session', () => {
  it('delivers what was published while no app was connected to the next one with the same client id', async () => {
    const clientId = `test-session-${random()}`;
    const base = `gw/test-${random()}/x`;
    const source = writer();
    const first = app(clientId);
    try {
      await first.waitUntilConnected(5000);
      await subscribed(first, source, base);
      await first.close();

      for (let index = 0; index < 50; index += 1) {
        await source.publishAsync(`${base}/a`, `m${index}`, { qos: 1 });
      }

      const second = app(clientId);
      try {
        const seen: string[] = [];
        // Other subscriptions first, as another start order would have it.
        second.subscribe(`gw/test-${random()}/y/#`, () => undefined);
        second.subscribe(`${base}/#`, (_topic, payload) => {
          seen.push(payload.toString());
        });
        const wanted = Array.from({ length: 50 }, (_, index) => `m${index}`);
        await vi.waitFor(() => expect(seen.filter((value) => value !== 'probe')).toEqual(wanted), {
          timeout: 10_000,
        });
        // Nothing arrives twice.
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(seen.filter((value) => value !== 'probe')).toEqual(wanted);
      } finally {
        await second.close();
      }
    } finally {
      await source.endAsync(true);
    }
  });

  it('does not queue for an unsubscribed filter', async () => {
    const clientId = `test-session-${random()}`;
    const base = `gw/test-${random()}/x`;
    const source = writer();
    const first = app(clientId);
    try {
      await first.waitUntilConnected(5000);
      const { unsubscribe } = await subscribed(first, source, base);
      unsubscribe();
      await first.close();
      await source.publishAsync(`${base}/a`, 'missed', { qos: 1 });
      await source.publishAsync(`${base}/probe`, 'later', { qos: 1 });

      const second = app(clientId);
      try {
        await second.waitUntilConnected(5000);
        const seen: string[] = [];
        // A stale copy would arrive with the identifier of the old subscription; nothing may.
        second.subscribe(`gw/test-${random()}/y/#`, (_topic, payload) => {
          seen.push(payload.toString());
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        expect(seen).toEqual([]);
      } finally {
        await second.close();
      }
    } finally {
      await source.endAsync(true);
    }
  });

  it('delivers a message again that was in progress when the app shut down', async () => {
    const clientId = `test-session-${random()}`;
    const base = `gw/test-${random()}/x`;
    const source = writer();
    const first = app(clientId);
    try {
      await first.waitUntilConnected(5000);
      const taken: string[] = [];
      const unsubscribe = first.subscribe(
        `${base}/#`,
        (_topic, payload) => {
          taken.push(payload.toString());
          return new Promise<void>(() => undefined);
        },
        { qos: 1, ackAfterHandler: true },
      );
      await vi.waitFor(async () => {
        await source.publishAsync(`${base}/a`, 'in-progress', { qos: 1 });
        expect(taken).toContain('in-progress');
      });
      // What the ingest does on shutdown: let go of the handler, keep the broker's subscription.
      unsubscribe({ keepSession: true });
      await source.publishAsync(`${base}/a`, 'after', { qos: 1 });
      await first.close();

      const second = app(clientId);
      try {
        const seen: string[] = [];
        second.subscribe(`${base}/#`, (_topic, payload) => {
          seen.push(payload.toString());
        });
        await vi.waitFor(() => {
          expect(seen).toContain('in-progress');
          expect(seen).toContain('after');
        });
      } finally {
        await second.close();
      }
    } finally {
      await source.endAsync(true);
    }
  });
});

describe('MqttConnection replay on start', () => {
  it('keeps the backlog until the app has subscribed, although the broker sends it first', async () => {
    const clientId = `test-session-${random()}`;
    const base = `gw/test-${random()}/x`;
    const source = writer();
    const first = app(clientId);
    try {
      await first.waitUntilConnected(5000);
      await subscribed(first, source, base);
      await first.close();
      for (let index = 0; index < 50; index += 1) {
        await source.publishAsync(`${base}/a`, `m${index}`, { qos: 1 });
      }

      const second = app(clientId, [], true);
      try {
        const seen: string[] = [];
        // The app looks up its gateways first: the broker's replay is there before the subscription.
        await new Promise((resolve) => setTimeout(resolve, 500));
        // A subscription of another filter that matches the topics must not take the backlog.
        const wide: string[] = [];
        second.subscribe(`gw/+/x/#`, (_topic, payload) => {
          wide.push(payload.toString());
        });
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(seen).toEqual([]);
        second.subscribe(`${base}/#`, (_topic, payload) => {
          seen.push(payload.toString());
        });
        second.markSubscriptionsComplete();
        const wanted = Array.from({ length: 50 }, (_, index) => `m${index}`);
        await vi.waitFor(() => expect(seen.filter((value) => value !== 'probe')).toEqual(wanted), {
          timeout: 10_000,
        });
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(seen.filter((value) => value !== 'probe')).toEqual(wanted);
      } finally {
        await second.close();
      }
    } finally {
      await source.endAsync(true);
    }
  });
});

describe('MqttConnection acknowledgement time limit', () => {
  it('acknowledges a handler that never ends after 30 s and goes on with the next message', async () => {
    const errors: Error[] = [];
    const reader = app(`test-session-${random()}`, errors);
    const source = writer();
    const base = `gw/test-${random()}/x`;
    try {
      await reader.waitUntilConnected(5000);
      const seen: string[] = [];
      reader.subscribe(
        `${base}/#`,
        (_topic, payload) => {
          seen.push(payload.toString());
          return payload.toString() === 'stuck' ? new Promise<void>(() => undefined) : undefined;
        },
        { qos: 1, ackAfterHandler: true },
      );
      await vi.waitFor(async () => {
        await source.publishAsync(`${base}/probe`, 'probe', { qos: 1 });
        expect(seen).toContain('probe');
      });

      // Only the timer of the time limit is the test's to wind forward.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        await source.publishAsync(`${base}/a`, 'stuck', { qos: 1 });
        await source.publishAsync(`${base}/b`, 'next', { qos: 1 });
        await vi.waitFor(() => expect(seen).toContain('stuck'));
        expect(seen).not.toContain('next');
        await vi.advanceTimersByTimeAsync(30_000);
      } finally {
        vi.useRealTimers();
      }
      await vi.waitFor(() => expect(seen).toContain('next'));
      expect(errors.map((error) => error.message).join()).toContain('did not finish');
      expect(errors.map((error) => error.message).join()).not.toContain('stuck');
    } finally {
      await reader.close();
      await source.endAsync(true);
    }
  });
});
