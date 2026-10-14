import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { GATEWAY_ID_PATTERN, type GatewayStatus } from '@smart/contracts';
import { describeError } from '../../platform/errors/index.js';
import { MQTT_CONNECTION, MqttConnection } from '../../platform/mqtt/index.js';
import { CLOCK, type Clock } from '../identity/index.js';
import {
  GATEWAY_STATUS_CHANGED,
  GatewayEvents,
  type GatewayStatusChanged,
} from './gateway-events.js';
import {
  STATUS_MEMORY_LIMIT,
  StatusMemory,
  type GatewayStatusKind,
} from './gateway-status-memory.js';
import { GatewaysRepository } from './gateways.repository.js';
import { Throttle } from './throttle.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
/** A status payload is a few bytes; anything bigger is not one. */
const MAX_STATE_BYTES = 1024;

/** Parses a bridge status payload: the text `online`/`offline` or JSON `{"state":"…"}`. */
function parseBridgeState(payload: Buffer): GatewayStatus | undefined {
  if (payload.length > MAX_STATE_BYTES) return undefined;
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

/** Parses the MQTT last-will topic of the bridge: `1` is online, `0` is offline. */
function parseConnection(payload: Buffer): GatewayStatus | undefined {
  if (payload.length > MAX_STATE_BYTES) return undefined;
  const text = payload.toString('utf8').trim();
  if (text === '1') return 'online';
  if (text === '0') return 'offline';
  return undefined;
}

/** The gateway ID in the second level of the topic, if it has the shape of one. */
function gatewayIdOf(topic: string): string | undefined {
  const id = topic.split('/')[1];
  return id !== undefined && GATEWAY_ID_PATTERN.test(id) ? id : undefined;
}

/**
 * Keeps the status of the gateways up to date from what they publish: the bridge's connection
 * topic, Zigbee2MQTT's `bridge/state` and any message below the gateway's z2m prefix (sign of
 * life). Messages are handled one after the other; a failure never ends the consumer.
 */
@Injectable()
export class GatewayStatusConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewayStatusConsumer.name);
  private readonly touches = new Throttle(MINUTE_MS, STATUS_MEMORY_LIMIT);
  private readonly notices = new Throttle(HOUR_MS, STATUS_MEMORY_LIMIT);
  private readonly failures = new Throttle(MINUTE_MS, 1);
  private readonly unsubscribes: (() => void)[] = [];
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly gateways: GatewaysRepository,
    private readonly memory: StatusMemory,
    private readonly events: GatewayEvents,
    @Inject(MQTT_CONNECTION) private readonly mqtt: MqttConnection,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.unsubscribes.push(
      this.mqtt.subscribe('gw/+/bridge/connection', (topic, payload) => {
        this.onStatus(topic, parseConnection(payload), 'bridge');
      }),
      this.mqtt.subscribe('gw/+/z2m/bridge/state', (topic, payload) => {
        this.onStatus(topic, parseBridgeState(payload), 'z2m');
      }),
      this.mqtt.subscribe('gw/+/z2m/#', (topic, _payload, retained) => {
        // A retained message is a replay on subscribing, not a sign that the gateway is alive.
        if (!retained) this.onActivity(topic);
      }),
    );
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
  }

  /** Resolves when the messages received so far are processed. */
  idle(): Promise<void> {
    return this.tail;
  }

  private onStatus(topic: string, status: GatewayStatus | undefined, kind: GatewayStatusKind) {
    const id = gatewayIdOf(topic);
    if (id === undefined || status === undefined) return;
    const now = this.clock();
    // Remembered also when the gateway is not registered (yet): registering picks it up.
    this.memory.record(id, kind, status, now);
    this.enqueue(async () => {
      const outcome = await this.gateways.applyStatus(id, kind, status, now);
      if (outcome === 'ignored') this.noticeIgnored(id, now);
      if (outcome === 'changed') {
        const event: GatewayStatusChanged = { gatewayId: id, kind, status, at: now };
        this.events.emit(GATEWAY_STATUS_CHANGED, event);
      }
    });
  }

  private onActivity(topic: string): void {
    const id = gatewayIdOf(topic);
    const now = this.clock();
    if (id === undefined || !this.touches.allow(id, now)) return;
    this.enqueue(async () => {
      if (!(await this.gateways.touch(id, now))) this.noticeIgnored(id, now);
    });
  }

  private noticeIgnored(id: string, now: Date): void {
    if (this.notices.allow(id, now)) {
      this.logger.log(`Ignoring messages of ${id}: it is not registered or was revoked`);
    }
  }

  private enqueue(task: () => Promise<void>): void {
    this.tail = this.tail.then(task).catch((error: unknown) => {
      // Neither the reason nor the message is logged: both could quote the payload.
      if (this.failures.allow('failure', this.clock())) {
        this.logger.warn(`Cannot process a gateway message: ${describeError(error)}`);
      }
    });
  }
}
