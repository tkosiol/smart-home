import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Availability } from '@smart/contracts';
import * as z from 'zod';
import { describeError } from '../../platform/errors/index.js';
import { MQTT_CONNECTION, MqttConnection, type Unsubscribe } from '../../platform/mqtt/index.js';
import {
  GATEWAY_REGISTERED,
  GATEWAY_REVOKED,
  GatewayEvents,
  GatewaysService,
  Throttle,
  isBridgeTopic,
  isCommandTopic,
  type GatewayRegistered,
  type GatewayRevoked,
} from '../gateways/index.js';
import { CLOCK, type Clock } from '../identity/index.js';
import { DEVICE_MESSAGE_HANDLER, type DeviceMessageHandler } from './device-message-handler.js';
import { capabilitiesFromExposes, exposesSchema } from './exposes.js';
import { HardwareRepository, type Z2mDevice } from './hardware.repository.js';
import { NameMap } from './name-map.js';

const MINUTE_MS = 60_000;
const RETRY_MS = 5000;
const HOUR_MS = 3_600_000;
/** Bounds for everything kept per name or per message: the oldest entries are forgotten. */
const MEMORY_LIMIT = 1000;
/**
 * Bytes of the messages waiting to be handled. The acknowledgement of a message is held back until
 * it is handled, so the broker delivers no faster than the database takes them and the queue holds
 * a few messages; this is only a safety net. Beyond it new messages are dropped.
 */
const MAX_QUEUED_BYTES = 64 * 1024 * 1024;
/** A gateway with a hundred devices lists about a megabyte. */
const MAX_DEVICES_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_AVAILABILITY_BYTES = 1024;
const MAX_NAME_LOG = 80;
/** Longest wait for the messages already taken when the app shuts down. */
export const SHUTDOWN_DRAIN_MS = 10_000;

const IEEE_ADDRESS = /^0x[0-9a-f]{16}$/i;
const AVAILABILITY_SUFFIX = '/availability';

const bridgeDeviceSchema = z.object({
  ieee_address: z.string().regex(IEEE_ADDRESS),
  friendly_name: z.string().min(1).max(255),
  type: z.string().optional().catch(undefined),
  interview_state: z.string().optional().catch(undefined),
  manufacturer: z.string().optional().catch(undefined),
  model_id: z.string().optional().catch(undefined),
  definition: z.unknown().optional(),
});
/** The entries are parsed one by one: a malformed one must not cost the others. */
const bridgeDevicesSchema = z.array(z.unknown());
const definitionInfoSchema = z.object({
  vendor: z.string().optional().catch(undefined),
  model: z.string().optional().catch(undefined),
  description: z.string().optional().catch(undefined),
  exposes: exposesSchema.catch([]),
});

const ieeeAddress = z.string().regex(IEEE_ADDRESS);
const friendlyName = z.string().min(1).max(255);
const bridgeEventSchema = z.object({ type: z.string(), data: z.unknown().optional() });
const joinedSchema = z.object({ ieee_address: ieeeAddress, friendly_name: friendlyName });
const interviewSchema = z.object({
  ieee_address: ieeeAddress,
  status: z.enum(['started', 'successful', 'failed']),
});
const leaveSchema = z.object({ ieee_address: ieeeAddress });
const renamedSchema = z.object({ from: friendlyName, to: friendlyName });
const INTERVIEW_STATES = {
  started: 'IN_PROGRESS',
  successful: 'SUCCESSFUL',
  failed: 'FAILED',
} as const;

const parseJson = (payload: Buffer): unknown => {
  try {
    return JSON.parse(payload.toString('utf8'));
  } catch {
    return undefined;
  }
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parses Z2M's availability: the text `online`/`offline` or JSON `{"state":"…"}`. */
function parseAvailability(payload: Buffer): Availability | undefined {
  const text = payload.toString('utf8').trim();
  if (text === 'online' || text === 'offline') return text;
  const json = parseJson(payload);
  const state = isObject(json) ? json.state : undefined;
  return state === 'online' || state === 'offline' ? state : undefined;
}

/** What is stored of one entry of `bridge/devices`. */
function toZ2mDevice(entry: z.infer<typeof bridgeDeviceSchema>): Z2mDevice {
  const info = definitionInfoSchema.safeParse(entry.definition);
  const definition = info.success ? info.data : undefined;
  return {
    ieeeAddress: entry.ieee_address,
    friendlyName: entry.friendly_name,
    vendor: definition?.vendor ?? entry.manufacturer ?? '',
    model: definition?.model ?? entry.model_id ?? '',
    description: definition?.description ?? null,
    // As reported; a device Z2M does not support has none.
    definition: isObject(entry.definition) ? entry.definition : {},
    interviewState: entry.interview_state ?? 'UNKNOWN',
    capabilities: capabilitiesFromExposes(definition?.exposes ?? []),
  };
}

type Route = 'devices' | 'event' | 'message';

/** What a topic below the gateway's prefix is, by its remainder; `undefined` if it is of no use. */
function routeOf(rest: string): Route | undefined {
  if (rest === 'bridge/devices') return 'devices';
  if (rest === 'bridge/event') return 'event';
  return isBridgeTopic(rest) ? undefined : 'message';
}

/**
 * Discovers hardware from what the registered gateways publish and hands their messages on. It
 * subscribes to the prefix of every active gateway (also those registered or revoked while it
 * runs), keeps `friendly_name` → hardware per gateway and processes the messages one after the
 * other, so that a message never overtakes the device list or rename it depends on. Payloads are
 * never logged.
 */
@Injectable()
export class DeviceIngestConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeviceIngestConsumer.name);
  private readonly names = new NameMap();
  private readonly notices = new Throttle(HOUR_MS, MEMORY_LIMIT);
  private readonly failures = new Throttle(MINUTE_MS, 3);
  private readonly subscriptions = new Map<string, Unsubscribe>();
  /** A revoked gateway stays revoked; this keeps a `follow` that is still loading from undoing it. */
  private readonly revoked = new Set<string>();
  /** Availability heard for a name that the device list does not have (yet). */
  private readonly pendingAvailability = new Map<string, Availability>();
  private controlTail: Promise<void> = Promise.resolve();
  private workTail: Promise<void> = Promise.resolve();
  private queuedBytes = 0;
  private dropped = 0;
  private destroyed = false;
  private destroying: Promise<void> | undefined;
  private retry: NodeJS.Timeout | undefined;
  private readonly onRegistered = (event: GatewayRegistered): void => {
    this.controlInBackground(() => this.follow(event.gatewayId, event.topicPrefix));
  };
  /** Immediately, not queued: nothing of a revoked gateway may be handled any more. */
  private readonly onRevoked = (event: GatewayRevoked): void => {
    this.revoked.add(event.gatewayId);
    this.unfollow(event.gatewayId);
  };

  /** Messages thrown away since start, by reason. */
  readonly discarded = { unknownName: 0, invalid: 0, overflow: 0 };

  constructor(
    private readonly gateways: GatewaysService,
    private readonly events: GatewayEvents,
    private readonly hardware: HardwareRepository,
    @Inject(DEVICE_MESSAGE_HANDLER) private readonly handler: DeviceMessageHandler,
    @Inject(MQTT_CONNECTION) private readonly mqtt: MqttConnection,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.events.on(GATEWAY_REGISTERED, this.onRegistered);
    this.events.on(GATEWAY_REVOKED, this.onRevoked);
    this.subscribeToActiveGateways();
  }

  /**
   * Stops taking messages and returns when those already taken are handled, so that nothing is
   * written after the modules this depends on (the measurement writer, the database) are closed;
   * at most {@link SHUTDOWN_DRAIN_MS}: what is still unhandled then was not acknowledged and the
   * broker delivers it again to the next start.
   */
  onModuleDestroy(): Promise<void> {
    this.destroying ??= this.shutDown();
    return this.destroying;
  }

  private async shutDown(): Promise<void> {
    this.destroyed = true;
    clearTimeout(this.retry);
    this.events.off(GATEWAY_REGISTERED, this.onRegistered);
    this.events.off(GATEWAY_REVOKED, this.onRevoked);
    // The gateways stay followed until the queue is empty: messages waiting for a gateway whose
    // subscription is gone are skipped as those of a revoked one. The subscriptions at the broker
    // stay (the session is persistent): it queues what arrives until the next start, while
    // nothing more is taken here.
    for (const unsubscribe of this.subscriptions.values()) unsubscribe({ keepSession: true });
    let timer: NodeJS.Timeout | undefined;
    const drained = await Promise.race([
      this.idle().then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => {
          resolve(false);
        }, SHUTDOWN_DRAIN_MS);
      }),
    ]);
    clearTimeout(timer);
    if (!drained) {
      this.logger.warn(
        `Shutting down with messages not handled yet (${this.queuedBytes} bytes); ` +
          'they are not acknowledged and arrive again after the restart',
      );
    }
    this.subscriptions.clear();
  }

  /**
   * The app starts without waiting for the database (it reports itself as down meanwhile): until
   * the gateways can be listed, this tries again every few seconds.
   */
  private subscribeToActiveGateways(): void {
    this.control(async () => {
      for (const gateway of await this.gateways.listActive()) {
        await this.follow(gateway.id, gateway.topicPrefix);
      }
    })
      .then(() => {
        // What the broker queued while the app was down is replayed on connecting, before the
        // above: the connection holds it until the subscriptions are there.
        // Not when shutting down meanwhile: the gateways are not all followed then.
        if (!this.destroyed) this.mqtt.markSubscriptionsComplete();
      })
      .catch((error: unknown) => {
        if (this.failures.allow('start', this.clock())) {
          this.logger.warn(`Cannot subscribe to the gateways yet: ${describeError(error)}`);
        }
        if (this.destroyed) return;
        this.retry = setTimeout(() => {
          this.subscribeToActiveGateways();
        }, RETRY_MS);
        this.retry.unref();
      });
  }

  /** Resolves when the messages and gateway changes received so far are processed. */
  async idle(): Promise<void> {
    let control: Promise<void>;
    let work: Promise<void>;
    do {
      control = this.controlTail;
      work = this.workTail;
      await Promise.all([control, work]);
    } while (control !== this.controlTail || work !== this.workTail);
  }

  /** Subscribes to the gateway's prefix, with its names loaded first. */
  private async follow(gatewayId: string, topicPrefix: string): Promise<void> {
    if (this.subscriptions.has(gatewayId) || this.revoked.has(gatewayId) || this.destroyed) return;
    const names = await this.hardware.listNames(gatewayId);
    if (this.subscriptions.has(gatewayId) || this.revoked.has(gatewayId) || this.destroyed) return;
    this.names.replace(gatewayId, names);
    this.subscriptions.set(
      gatewayId,
      this.mqtt.subscribe(
        `${topicPrefix}/#`,
        (topic, payload, retained) => this.accept(gatewayId, topicPrefix, topic, payload, retained),
        // Acknowledged once handled: the broker's delivery follows the pace of the database.
        { qos: 1, ackAfterHandler: true },
      ),
    );
  }

  private unfollow(gatewayId: string): void {
    this.subscriptions.get(gatewayId)?.();
    this.subscriptions.delete(gatewayId);
    this.names.forget(gatewayId);
    const keyPrefix = this.pendingKey(gatewayId, '');
    for (const key of this.pendingAvailability.keys()) {
      if (key.startsWith(keyPrefix)) this.pendingAvailability.delete(key);
    }
  }

  /** Settles when the message is handled (at once if it is of no use), to acknowledge it then. */
  private accept(
    gatewayId: string,
    topicPrefix: string,
    topic: string,
    payload: Buffer,
    retained: boolean,
  ): Promise<void> | undefined {
    const rest = topic.slice(topicPrefix.length + 1);
    if (!topic.startsWith(`${topicPrefix}/`) || rest === '') return;
    const route = routeOf(rest);
    if (route === undefined) return;
    const limit =
      route === 'devices'
        ? MAX_DEVICES_BYTES
        : rest.endsWith(AVAILABILITY_SUFFIX)
          ? MAX_AVAILABILITY_BYTES
          : MAX_MESSAGE_BYTES;
    if (payload.length > limit) {
      this.discard('invalid', gatewayId, 'oversized');
      return;
    }
    if (this.queuedBytes + payload.length > MAX_QUEUED_BYTES) {
      this.drop();
      return;
    }
    this.queuedBytes += payload.length;
    this.workTail = this.workTail
      .then(() => this.process(gatewayId, route, rest, payload, retained))
      .catch((error: unknown) => {
        // Neither the reason nor the message is logged: both could quote the payload.
        if (this.failures.allow('failure', this.clock())) {
          this.logger.warn(`Cannot process a device message: ${describeError(error)}`);
        }
      })
      .finally(() => {
        this.queuedBytes -= payload.length;
      });
    return this.workTail;
  }

  /** Counts a message thrown away for lack of room; says so at most once a minute. */
  private drop(): void {
    this.discarded.overflow += 1;
    this.dropped += 1;
    if (!this.failures.allow('drop', this.clock())) return;
    this.logger.warn(`Dropped ${this.dropped} messages: too many bytes are waiting`);
    this.dropped = 0;
  }

  private async process(
    gatewayId: string,
    route: Route,
    rest: string,
    payload: Buffer,
    retained: boolean,
  ): Promise<void> {
    // The gateway may have been revoked while the message waited.
    if (!this.subscriptions.has(gatewayId)) return;
    if (route === 'devices') return this.onDevices(gatewayId, payload);
    if (route === 'event') return this.onEvent(gatewayId, payload);
    const hardwareId = this.names.lookup(gatewayId, rest);
    if (hardwareId !== undefined) {
      return this.onMessage(gatewayId, hardwareId, payload, retained);
    }
    if (rest.endsWith(AVAILABILITY_SUFFIX)) {
      return this.onAvailability(gatewayId, rest.slice(0, -AVAILABILITY_SUFFIX.length), payload);
    }
    if (isCommandTopic(rest)) return;
    this.discard(
      'unknownName',
      gatewayId,
      `unknown name ${JSON.stringify(rest.slice(0, MAX_NAME_LOG))}`,
    );
  }

  private async onDevices(gatewayId: string, payload: Buffer): Promise<void> {
    const parsed = bridgeDevicesSchema.safeParse(parseJson(payload));
    if (!parsed.success) return this.discard('invalid', gatewayId, 'bridge/devices');
    const devices: Z2mDevice[] = [];
    let valid = 0;
    for (const raw of parsed.data) {
      const entry = bridgeDeviceSchema.safeParse(raw);
      if (!entry.success) {
        this.discard('invalid', gatewayId, 'bridge/devices entry');
        continue;
      }
      valid += 1;
      if (entry.data.type !== 'Coordinator') devices.push(toZ2mDevice(entry.data));
    }
    // A list of nothing but garbage is no list: it must not mark all hardware as removed.
    if (valid === 0 && parsed.data.length > 0) return;
    await this.hardware.upsertFromBridge(gatewayId, devices, this.clock());
    const names = await this.hardware.listNames(gatewayId);
    if (!this.subscriptions.has(gatewayId)) return;
    this.names.replace(gatewayId, names);
    for (const { id, friendlyName: name } of names) {
      const key = this.pendingKey(gatewayId, name);
      const availability = this.pendingAvailability.get(key);
      if (availability === undefined) continue;
      this.pendingAvailability.delete(key);
      await this.hardware.setAvailability(id, availability);
    }
  }

  private async onEvent(gatewayId: string, payload: Buffer): Promise<void> {
    const event = bridgeEventSchema.safeParse(parseJson(payload));
    if (!event.success) return this.discard('invalid', gatewayId, 'bridge/event');
    const { type, data } = event.data;
    const now = this.clock();
    switch (type) {
      case 'device_joined': {
        const joined = joinedSchema.safeParse(data);
        if (!joined.success) return this.discard('invalid', gatewayId, type);
        const id = await this.hardware.recordJoined(
          gatewayId,
          joined.data.ieee_address,
          joined.data.friendly_name,
          now,
        );
        // The gateway may have been revoked while the row was written.
        if (this.subscriptions.has(gatewayId)) {
          this.names.set(gatewayId, joined.data.friendly_name, id);
        }
        return;
      }
      case 'device_interview': {
        const interview = interviewSchema.safeParse(data);
        if (!interview.success) return this.discard('invalid', gatewayId, type);
        await this.hardware.setInterviewState(
          gatewayId,
          interview.data.ieee_address,
          INTERVIEW_STATES[interview.data.status],
        );
        return;
      }
      case 'device_leave': {
        const left = leaveSchema.safeParse(data);
        if (!left.success) return this.discard('invalid', gatewayId, type);
        const gone = await this.hardware.markLeft(gatewayId, left.data.ieee_address, now);
        if (gone) this.names.remove(gatewayId, gone.friendlyName);
        return;
      }
      case 'device_renamed': {
        const renamed = renamedSchema.safeParse(data);
        if (!renamed.success) return this.discard('invalid', gatewayId, type);
        const { from, to } = renamed.data;
        const id = await this.hardware.rename(gatewayId, from, to);
        if (id !== undefined && this.subscriptions.has(gatewayId)) {
          this.names.rename(gatewayId, from, to, id);
        }
        return;
      }
      default:
        return;
    }
  }

  private async onAvailability(gatewayId: string, name: string, payload: Buffer): Promise<void> {
    const availability = parseAvailability(payload);
    if (availability === undefined) return this.discard('invalid', gatewayId, 'availability');
    const hardwareId = this.names.lookup(gatewayId, name);
    if (hardwareId !== undefined) return this.hardware.setAvailability(hardwareId, availability);
    // The retained availability can arrive before the device list: keep it for when that does.
    const key = this.pendingKey(gatewayId, name);
    this.pendingAvailability.delete(key);
    this.pendingAvailability.set(key, availability);
    if (this.pendingAvailability.size > MEMORY_LIMIT) {
      const oldest = this.pendingAvailability.keys().next();
      if (!oldest.done) this.pendingAvailability.delete(oldest.value);
    }
  }

  private async onMessage(
    gatewayId: string,
    hardwareId: string,
    payload: Buffer,
    retained: boolean,
  ): Promise<void> {
    const message = parseJson(payload);
    if (!isObject(message)) return this.discard('invalid', gatewayId, 'device message');
    await this.handler.handle(gatewayId, hardwareId, message, this.clock(), retained);
  }

  private pendingKey(gatewayId: string, name: string): string {
    return `${gatewayId}\0${name}`;
  }

  /** Counts a thrown-away message and says so, at most once an hour per reason. */
  private discard(reason: 'unknownName' | 'invalid', gatewayId: string, what: string): void {
    this.discarded[reason] += 1;
    this.notice(`${reason}:${gatewayId}:${what}`, `Discarding a message of ${gatewayId}: ${what}`);
  }

  private notice(key: string, message: string): void {
    if (this.notices.allow(key, this.clock())) this.logger.log(message);
  }

  /** Runs a change of subscriptions after the ones before it; the failure is the caller's. */
  private control(task: () => Promise<void>): Promise<void> {
    const result = this.controlTail.then(task);
    this.controlTail = result.catch(() => undefined);
    return result;
  }

  private controlInBackground(task: () => Promise<void>): void {
    this.control(task).catch((error: unknown) => {
      this.logger.warn(`Cannot change the gateway subscriptions: ${describeError(error)}`);
    });
  }
}
