import { connect, type IPublishPacket, type MqttClient } from 'mqtt';
import { matchesFilter } from './topic-filter.js';

export interface MqttSettings {
  url: string;
  username: string;
  password: string;
  clientId: string;
  onError?: (error: Error) => void;
}

export type MqttMessageHandler = (
  topic: string,
  payload: Buffer,
  retained: boolean,
) => void | Promise<void>;

export interface SubscribeOptions {
  /** The QoS the broker delivers at (at most the QoS of the publisher). Default 1. */
  qos?: 0 | 1 | 2;
  /**
   * Holds the acknowledgement of a message back until the handler (an async one returns its
   * promise) is done. The broker keeps what is unacknowledged, and a client that does not
   * acknowledge slows delivery down: backpressure for a consumer that cannot keep up. A handler
   * that fails still acknowledges, so one message cannot block the subscription for good.
   */
  ackAfterHandler?: boolean;
}

interface Subscription {
  filter: string;
  /** The subscription identifier the broker puts on messages that matched this filter. */
  id: number;
  handler: MqttMessageHandler;
  ackAfterHandler: boolean;
}

const isPromise = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as PromiseLike<unknown>).then === 'function';

/** Long-lived broker connection with automatic reconnect; errors never crash the process. */
export class MqttConnection {
  private readonly client: MqttClient;
  private readonly subscriptions = new Set<Subscription>();
  private readonly identifiers = new Map<string, number>();
  /** The QoS the broker was asked for, per filter. */
  private readonly levels = new Map<string, 0 | 1 | 2>();
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
    // mqtt.js acknowledges a message when this calls back, and handles the next one only after
    // that: a slow handler holds up the acknowledgements and so the broker's delivery.
    this.client.handleMessage = (packet, callback) => {
      this.dispatch(packet, callback);
    };
  }

  /**
   * Calls `handler` once for every message on a topic matching `filter` (also the retained ones
   * that the broker sends on subscribing) and returns a function that ends the subscription. A
   * message that matches several filters of this connection arrives once per filter; each copy
   * goes only to the handlers of the filter it came for, so no handler sees a message twice.
   * mqtt.js subscribes again after a reconnect (`clean` session, `resubscribe` default), so the
   * subscription outlives broker restarts. A handler that throws never breaks the connection.
   */
  subscribe(
    filter: string,
    handler: MqttMessageHandler,
    options: SubscribeOptions = {},
  ): () => void {
    const qos = options.qos ?? 1;
    const id = this.identifiers.get(filter) ?? ++this.lastIdentifier;
    this.identifiers.set(filter, id);
    const subscription: Subscription = {
      filter,
      id,
      handler,
      ackAfterHandler: options.ackAfterHandler ?? false,
    };
    this.subscriptions.add(subscription);
    const asked = this.levels.get(filter);
    // One subscription per filter at the broker, with the highest QoS any handler asked for.
    if (asked === undefined || qos > asked) {
      this.levels.set(filter, qos);
      this.client.subscribe(
        filter,
        { qos, properties: { subscriptionIdentifier: id } },
        (error) => {
          if (error) this.onError(error);
        },
      );
    }
    return () => {
      if (!this.subscriptions.delete(subscription)) return;
      if ([...this.subscriptions].some((other) => other.filter === filter)) return;
      this.identifiers.delete(filter);
      this.levels.delete(filter);
      try {
        this.client.unsubscribe(filter);
      } catch (error) {
        this.onError(error instanceof Error ? error : new Error('unsubscribe failed'));
      }
    };
  }

  /**
   * Hands the copy to the handlers of the filters it came for (by subscription identifier; by
   * filter when the copy carries none) and calls back when those that gate the acknowledgement
   * are done.
   */
  private dispatch(packet: IPublishPacket, callback: () => void): void {
    const topic = packet.topic.toString();
    const payload = Buffer.isBuffer(packet.payload) ? packet.payload : Buffer.from(packet.payload);
    const found = packet.properties?.subscriptionIdentifier;
    const identifiers = found === undefined ? undefined : [found].flat();
    const gating: PromiseLike<unknown>[] = [];
    for (const { filter, id, handler, ackAfterHandler } of [...this.subscriptions]) {
      const matches =
        identifiers === undefined ? matchesFilter(filter, topic) : identifiers.includes(id);
      if (!matches) continue;
      try {
        const result = handler(topic, payload, packet.retain);
        if (isPromise(result)) {
          const settled = Promise.resolve(result).catch(() => {
            // The reason is not passed on: it could quote the payload.
            this.onError(new Error('a message handler failed'));
          });
          if (ackAfterHandler) gating.push(settled);
        }
      } catch {
        this.onError(new Error('a message handler failed'));
      }
    }
    if (gating.length === 0) {
      callback();
      return;
    }
    void Promise.all(gating).then(() => {
      callback();
    });
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
