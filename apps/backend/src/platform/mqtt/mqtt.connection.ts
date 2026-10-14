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
  /** The subscription identifier the broker puts on messages that matched this filter. */
  id: number;
  handler: MqttMessageHandler;
}

/** Long-lived broker connection with automatic reconnect; errors never crash the process. */
export class MqttConnection {
  private readonly client: MqttClient;
  private readonly subscriptions = new Set<Subscription>();
  private readonly identifiers = new Map<string, number>();
  private lastIdentifier = 0;
  private readonly onError: (error: Error) => void;

  constructor(settings: MqttSettings) {
    this.onError = (error) => settings.onError?.(error);
    this.client = connect(settings.url, {
      username: settings.username,
      password: settings.password,
      clientId: settings.clientId,
      // MQTT 5: subscription identifiers tell which of overlapping subscriptions a copy is for.
      protocolVersion: 5,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 2000,
    });
    this.client.on('error', this.onError);
    this.client.on('message', (topic, payload, packet) => {
      const identifiers = packet.properties?.subscriptionIdentifier;
      this.dispatch(
        topic,
        payload,
        packet.retain,
        identifiers === undefined ? undefined : [identifiers].flat(),
      );
    });
  }

  /**
   * Calls `handler` once for every message on a topic matching `filter` (also the retained ones
   * that the broker sends on subscribing) and returns a function that ends the subscription. A
   * message that matches several filters of this connection arrives once per filter; each copy
   * goes only to the handlers of the filter it came for, so no handler sees a message twice.
   * mqtt.js subscribes again after a reconnect (`clean` session, `resubscribe` default), so the
   * subscription outlives broker restarts. A handler that throws never breaks the connection.
   */
  subscribe(filter: string, handler: MqttMessageHandler): () => void {
    const known = this.identifiers.get(filter);
    const id = known ?? ++this.lastIdentifier;
    this.identifiers.set(filter, id);
    const subscription: Subscription = { filter, id, handler };
    this.subscriptions.add(subscription);
    if (known === undefined) {
      this.client.subscribe(
        filter,
        { qos: 1, properties: { subscriptionIdentifier: id } },
        (error) => {
          if (error) this.onError(error);
        },
      );
    }
    return () => {
      if (!this.subscriptions.delete(subscription)) return;
      if ([...this.subscriptions].some((other) => other.filter === filter)) return;
      this.identifiers.delete(filter);
      try {
        this.client.unsubscribe(filter);
      } catch (error) {
        this.onError(error instanceof Error ? error : new Error('unsubscribe failed'));
      }
    };
  }

  /** `identifiers` are the subscription identifiers of the copy; without them it is by filter. */
  private dispatch(
    topic: string,
    payload: Buffer,
    retained: boolean,
    identifiers: readonly number[] | undefined,
  ): void {
    for (const { filter, id, handler } of [...this.subscriptions]) {
      const matches =
        identifiers === undefined ? matchesFilter(filter, topic) : identifiers.includes(id);
      if (!matches) continue;
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
