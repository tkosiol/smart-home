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
import { MQTT_CONNECTION, MqttConnection } from '../../platform/mqtt/index.js';
import {
  GATEWAY_REGISTERED,
  GATEWAY_REVOKED,
  GatewayEvents,
  GatewaysService,
  Throttle,
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
/** Messages waiting to be handled; beyond this the database is not keeping up and new ones go. */
const MAX_QUEUED = 1000;
/** A gateway with a hundred devices lists about a megabyte. */
const MAX_DEVICES_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_AVAILABILITY_BYTES = 1024;
const MAX_NAME_LOG = 80;

const IEEE_ADDRESS = /^0x[0-9a-f]{16}$/i;
/** `<name>/set`, `<name>/set/<attribute>` and the same with `get`: commands, not device messages. */
const COMMAND_TOPIC = /\/(?:set|get)(?:\/[^/]+)?$/;
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
const bridgeDevicesSchema = z.array(bridgeDeviceSchema);
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
  return rest.startsWith('bridge/') ? undefined : 'message';
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
  private readonly failures = new Throttle(MINUTE_MS, 2);
  private readonly subscriptions = new Map<string, () => void>();
  /** A revoked gateway stays revoked; this keeps a `follow` that is still loading from undoing it. */
  private readonly revoked = new Set<string>();
  /** Availability heard for a name that the device list does not have (yet). */
  private readonly pendingAvailability = new Map<string, Availability>();
  private controlTail: Promise<void> = Promise.resolve();
  private workTail: Promise<void> = Promise.resolve();
  private queued = 0;
  private destroyed = false;
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
  readonly discarded = { unknownName: 0, invalid: 0 };

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

  onModuleDestroy(): void {
    this.destroyed = true;
    clearTimeout(this.retry);
    this.events.off(GATEWAY_REGISTERED, this.onRegistered);
    this.events.off(GATEWAY_REVOKED, this.onRevoked);
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
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
    }).catch((error: unknown) => {
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
      this.mqtt.subscribe(`${topicPrefix}/#`, (topic, payload, retained) => {
        this.accept(gatewayId, topicPrefix, topic, payload, retained);
      }),
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

  private accept(
    gatewayId: string,
    topicPrefix: string,
    topic: string,
    payload: Buffer,
    retained: boolean,
  ): void {
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
    if (this.queued >= MAX_QUEUED) {
      this.notice(`queue:${gatewayId}`, `Dropping messages of ${gatewayId}: too many are waiting`);
      return;
    }
    this.queued += 1;
    this.workTail = this.workTail
      .then(() => this.process(gatewayId, route, rest, payload, retained))
      .catch((error: unknown) => {
        // Neither the reason nor the message is logged: both could quote the payload.
        if (this.failures.allow('failure', this.clock())) {
          this.logger.warn(`Cannot process a device message: ${describeError(error)}`);
        }
      })
      .finally(() => {
        this.queued -= 1;
      });
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
    if (COMMAND_TOPIC.test(rest)) return;
    this.discard(
      'unknownName',
      gatewayId,
      `unknown name ${JSON.stringify(rest.slice(0, MAX_NAME_LOG))}`,
    );
  }

  private async onDevices(gatewayId: string, payload: Buffer): Promise<void> {
    const parsed = bridgeDevicesSchema.safeParse(parseJson(payload));
    if (!parsed.success) return this.discard('invalid', gatewayId, 'bridge/devices');
    const devices = parsed.data.filter((entry) => entry.type !== 'Coordinator').map(toZ2mDevice);
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
