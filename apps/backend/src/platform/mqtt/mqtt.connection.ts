import { connect, type MqttClient } from 'mqtt';
import { matchesFilter } from './topic-filter.js';

export interface MqttSettings {
  url: string;
  username: string;
  password: string;
  clientId: string;
  onError?: (error: Error) => void;
}

export type MqttMessageHandler = (topic: string, payload: Buffer, retained: boolean) => void;

interface Subscription {
  filter: string;
  handler: MqttMessageHandler;
}

/** Long-lived broker connection with automatic reconnect; errors never crash the process. */
export class MqttConnection {
  private readonly client: MqttClient;
  private readonly subscriptions = new Set<Subscription>();
  private readonly onError: (error: Error) => void;

  constructor(settings: MqttSettings) {
    this.onError = (error) => settings.onError?.(error);
    this.client = connect(settings.url, {
      username: settings.username,
      password: settings.password,
      clientId: settings.clientId,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 2000,
    });
    this.client.on('error', this.onError);
    this.client.on('message', (topic, payload, packet) => {
      this.dispatch(topic, payload, packet.retain);
    });
  }

  /**
   * Calls `handler` for every message on a topic matching `filter` (also the retained ones that
   * the broker sends on subscribing) and returns a function that ends the subscription. mqtt.js
   * subscribes again after a reconnect (`clean` session, `resubscribe` default), so the
   * subscription outlives broker restarts. A handler that throws never breaks the connection.
   */
  subscribe(filter: string, handler: MqttMessageHandler): () => void {
    const subscription: Subscription = { filter, handler };
    const known = [...this.subscriptions].some((other) => other.filter === filter);
    this.subscriptions.add(subscription);
    if (!known) {
      this.client.subscribe(filter, { qos: 1 }, (error) => {
        if (error) this.onError(error);
      });
    }
    return () => {
      if (!this.subscriptions.delete(subscription)) return;
      if ([...this.subscriptions].some((other) => other.filter === filter)) return;
      try {
        this.client.unsubscribe(filter);
      } catch (error) {
        this.onError(error instanceof Error ? error : new Error('unsubscribe failed'));
      }
    };
  }

  private dispatch(topic: string, payload: Buffer, retained: boolean): void {
    for (const { filter, handler } of [...this.subscriptions]) {
      if (!matchesFilter(filter, topic)) continue;
      try {
        handler(topic, payload, retained);
      } catch {
        // The reason is not passed on: it could quote the payload.
        this.onError(new Error('a message handler failed'));
      }
    }
  }

  isConnected(): boolean {
    return this.client.connected;
  }

  waitUntilConnected(timeoutMs: number): Promise<boolean> {
    if (this.client.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const onConnect = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.client.off('connect', onConnect);
        resolve(false);
      }, timeoutMs);
      this.client.once('connect', onConnect);
    });
  }

  async close(): Promise<void> {
    await this.client.endAsync(true);
  }
}
