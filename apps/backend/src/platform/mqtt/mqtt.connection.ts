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

/** Ends a subscription; see `keepSession` for what it can leave to the next process. */
export type Unsubscribe = (options?: { keepSession?: boolean }) => void;

interface Subscription {
  filter: string;
  /** The subscription identifier the broker puts on messages that matched this filter. */
  id: number;
  handler: MqttMessageHandler;
  ackAfterHandler: boolean;
  /** Ended with `keepSession`: the handler is gone, the subscription at the broker is not. */
  released: boolean;
}

/** How long the broker's session outlives the connection (seconds). */
const SESSION_EXPIRY_SECONDS = 86_400;
/** A gated handler that is not done by then no longer holds the acknowledgement back. */
export const ACK_TIMEOUT_MS = 30_000;
/** MQTT 5 subscription identifiers are 1 to 268 435 455. */
const MAX_IDENTIFIER = 268_435_455;

/** FNV-1a: the same text gives the same number in every process. */
function hash(text: string): number {
  let value = 0x81_1c_9d_c5;
  for (const byte of Buffer.from(text)) {
    value = Math.imul(value ^ byte, 0x01_00_01_93) >>> 0;
  }
  return value;
}

const isPromise = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as PromiseLike<unknown>).then === 'function';

/**
 * Long-lived broker connection with automatic reconnect; errors never crash the process. The
 * session at the broker outlives the connection (fixed client ID, no clean start, session expiry):
 * what the broker queues while the process is away is delivered to the next one with the same ID.
 */
export class MqttConnection {
  private readonly client: MqttClient;
  private readonly subscriptions = new Set<Subscription>();
  private readonly identifiers = new Map<string, number>();
  /** The QoS the broker was asked for, per filter. */
  private readonly levels = new Map<string, 0 | 1 | 2>();
  /** Timers of the copies that wait for their gating handlers, cleared on close. */
  private readonly ackTimers = new Set<NodeJS.Timeout>();
  private closed = false;
  private readonly onError: (error: Error) => void;

  constructor(settings: MqttSettings) {
    this.onError = (error) => settings.onError?.(error);
    this.client = connect(settings.url, {
      username: settings.username,
      password: settings.password,
      clientId: settings.clientId,
      // MQTT 5: subscription identifiers tell which of overlapping subscriptions a copy is for.
      protocolVersion: 5,
      // A persistent session: the broker keeps the subscriptions and queues what arrives while no
      // process is connected. mqtt.js subscribes again after a reconnect only when the broker
      // has lost the session (`sessionPresent` false), so a kept session is not subscribed twice.
      clean: false,
      properties: { sessionExpiryInterval: SESSION_EXPIRY_SECONDS },
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
   * The subscription outlives broker restarts (mqtt.js subscribes again when the session is
   * lost) and, with the persistent session, process restarts: the broker queues messages while
   * no process is connected. A handler that throws never breaks the connection. The returned
   * function ends the subscription at the broker too; with `keepSession` it only stops the
   * handler (for a shutdown): the broker goes on queuing, and what arrives for it meanwhile is
   * not acknowledged, so that it is delivered again to the next process.
   */
  subscribe(
    filter: string,
    handler: MqttMessageHandler,
    options: SubscribeOptions = {},
  ): Unsubscribe {
    const qos = options.qos ?? 1;
    const id = this.identifiers.get(filter) ?? this.identifierFor(filter);
    this.identifiers.set(filter, id);
    const subscription: Subscription = {
      filter,
      id,
      handler,
      ackAfterHandler: options.ackAfterHandler ?? false,
      released: false,
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
    return (ending) => {
      if (ending?.keepSession) {
        subscription.released = true;
        return;
      }
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
   * The identifier of a filter is derived from the filter itself, so that every process gives the
   * same one: the broker keeps the identifiers of a persistent session, and messages queued for
   * an earlier process must still find their handlers. (Two filters of one process that hash to
   * the same number get the next free one; that is as good as a number per subscribe order.)
   */
  private identifierFor(filter: string): number {
    const used = new Set(this.identifiers.values());
    let id = (hash(filter) % MAX_IDENTIFIER) + 1;
    while (used.has(id)) id = (id % MAX_IDENTIFIER) + 1;
    return id;
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
    const gatingFilters = new Set<string>();
    let held = false;
    for (const { filter, id, handler, ackAfterHandler, released } of [...this.subscriptions]) {
      // The topic is checked as well: an identifier that an earlier process gave to another filter
      // (the broker keeps those) must not send a message to the wrong handler.
      const matches =
        matchesFilter(filter, topic) && (identifiers === undefined || identifiers.includes(id));
      if (!matches) continue;
      if (released) {
        held = true;
        continue;
      }
      try {
        const result = handler(topic, payload, packet.retain);
        if (isPromise(result)) {
          const settled = Promise.resolve(result).catch(() => {
            // The reason is not passed on: it could quote the payload.
            this.onError(new Error('a message handler failed'));
          });
          if (ackAfterHandler) {
            gating.push(settled);
            gatingFilters.add(filter);
          }
        }
      } catch {
        this.onError(new Error('a message handler failed'));
      }
    }
    // Nobody handled it, and the broker must deliver it again: no acknowledgement.
    if (held) return;
    if (gating.length === 0) {
      callback();
      return;
    }
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      this.ackTimers.delete(timer);
      // Closed meanwhile: what was not handled is delivered again, not acknowledged.
      if (!this.closed) callback();
    };
    // A handler that never ends would hold up every message behind it for good. Only the filters
    // are named: topics and payloads could quote what devices sent.
    const timer = setTimeout(() => {
      this.onError(
        new Error(
          `a message handler did not finish within ${ACK_TIMEOUT_MS / 1000} s ` +
            `(filter ${[...gatingFilters].join(', ')})`,
        ),
      );
      finish();
    }, ACK_TIMEOUT_MS);
    timer.unref();
    this.ackTimers.add(timer);
    void Promise.all(gating).then(finish);
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
    this.closed = true;
    for (const timer of this.ackTimers) clearTimeout(timer);
    this.ackTimers.clear();
    await this.client.endAsync(true);
  }
}
