import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Availability } from '@smart/contracts';
import { describeError } from '../../platform/errors/index.js';
import { MQTT_CONNECTION, MqttConnection, type Unsubscribe } from '../../platform/mqtt/index.js';
import {
  AdapterRegistry,
  type AdapterEvent,
  type GatewayAdapter,
  type HardwareRef,
  type ReportedHardware,
  type SetupState,
} from '../adapters/index.js';
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
import { AddressBook } from './address-book.js';
import {
  DEVICE_CHANGED,
  DeviceEvents,
  HARDWARE_CHANGED,
  type DeviceChanged,
  type HardwareChanged,
} from './device-events.js';
import { DeviceReportProcessor } from './device-report.processor.js';
import { HardwareRepository } from './hardware.repository.js';

const MINUTE_MS = 60_000;
const RETRY_MS = 5000;
const HOUR_MS = 3_600_000;
/** Bounds for everything kept per address, per gateway or per message: the oldest are forgotten. */
const MEMORY_LIMIT = 1000;
/**
 * Bytes of the messages waiting to be handled. The acknowledgement of a message is held back until
 * it is handled, so the broker delivers no faster than the database takes them and the queue holds
 * a few messages; this is only a safety net. Beyond it new messages are dropped.
 */
const MAX_QUEUED_BYTES = 64 * 1024 * 1024;
const MAX_ADDRESS_LOG = 80;
/** Longest wait for the messages already taken when the app shuts down. */
export const SHUTDOWN_DRAIN_MS = 10_000;

/**
 * Hosts the gateway adapters: subscribes to the prefix of every active gateway (also those
 * registered or revoked while it runs), lets the gateway's adapter decide what a message is and
 * applies the neutral events it turns it into, one message after the other, so that a report
 * never overtakes the list or new address it depends on. Keeps address → hardware per gateway.
 * Knows nothing of any gateway kind's topics or payloads; payloads are never logged.
 */
@Injectable()
export class GatewayIngest implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewayIngest.name);
  private readonly addresses = new AddressBook();
  private readonly notices = new Throttle(HOUR_MS, MEMORY_LIMIT);
  private readonly failures = new Throttle(MINUTE_MS, 3);
  private readonly touches = new Throttle(MINUTE_MS, MEMORY_LIMIT);
  private readonly subscriptions = new Map<string, Unsubscribe>();
  /** A revoked gateway stays revoked; this keeps a `follow` that is still loading from undoing it. */
  private readonly revoked = new Set<string>();
  /** Availability heard for an address that the hardware list does not have (yet). */
  private readonly pendingAvailability = new Map<string, Availability>();
  private controlTail: Promise<void> = Promise.resolve();
  private workTail: Promise<void> = Promise.resolve();
  private queuedBytes = 0;
  private dropped = 0;
  private destroyed = false;
  private destroying: Promise<void> | undefined;
  private retry: NodeJS.Timeout | undefined;
  private readonly onRegistered = (event: GatewayRegistered): void => {
    this.controlInBackground(() => this.follow(event.gatewayId, event.kind, event.topicPrefix));
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
    private readonly processor: DeviceReportProcessor,
    private readonly adapters: AdapterRegistry,
    @Inject(MQTT_CONNECTION) private readonly mqtt: MqttConnection,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly deviceEvents: DeviceEvents,
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
        await this.follow(gateway.id, gateway.kind, gateway.topicPrefix);
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

  /** Subscribes to the gateway's prefix, with its addresses loaded first. */
  private async follow(gatewayId: string, kind: string, topicPrefix: string): Promise<void> {
    if (this.subscriptions.has(gatewayId) || this.revoked.has(gatewayId) || this.destroyed) return;
    const adapter = this.adapters.get(kind);
    if (adapter === undefined) {
      // E.g. a kind of a newer version after a rollback: its messages stay with the broker.
      this.notice(
        `kind:${gatewayId}`,
        `Not following ${gatewayId}: no adapter for its kind ${JSON.stringify(kind)}`,
      );
      return;
    }
    const addresses = await this.hardware.listAddresses(gatewayId);
    if (this.subscriptions.has(gatewayId) || this.revoked.has(gatewayId) || this.destroyed) return;
    this.addresses.replace(gatewayId, addresses);
    this.subscriptions.set(
      gatewayId,
      this.mqtt.subscribe(
        `${topicPrefix}/#`,
        (topic, payload, retained) =>
          this.accept(gatewayId, adapter, topicPrefix, topic, payload, retained),
        // Acknowledged once handled: the broker's delivery follows the pace of the database.
        { qos: 1, ackAfterHandler: true },
      ),
    );
  }

  private unfollow(gatewayId: string): void {
    this.subscriptions.get(gatewayId)?.();
    this.subscriptions.delete(gatewayId);
    this.addresses.forget(gatewayId);
    const keyPrefix = this.pendingKey(gatewayId, '');
    for (const key of this.pendingAvailability.keys()) {
      if (key.startsWith(keyPrefix)) this.pendingAvailability.delete(key);
    }
  }

  /** Settles when the message is handled (at once if it is of no use), to acknowledge it then. */
  private accept(
    gatewayId: string,
    adapter: GatewayAdapter,
    topicPrefix: string,
    topic: string,
    payload: Buffer,
    retained: boolean,
  ): Promise<void> | undefined {
    const rest = topic.slice(topicPrefix.length + 1);
    if (!topic.startsWith(`${topicPrefix}/`) || rest === '') return;
    const route = adapter.classify(rest);
    if (route === undefined) return;
    if (payload.length > route.maxBytes) {
      this.discard('invalid', gatewayId, 'oversized');
      return;
    }
    if (this.queuedBytes + payload.length > MAX_QUEUED_BYTES) {
      this.drop();
      return;
    }
    this.queuedBytes += payload.length;
    this.workTail = this.workTail
      .then(() => this.process(gatewayId, adapter, rest, payload, retained))
      .catch((error: unknown) => {
        // Neither the reason nor the message is logged: both could quote the payload.
        if (this.failures.allow('failure', this.clock())) {
          this.logger.warn(`Cannot process a gateway message: ${describeError(error)}`);
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
    adapter: GatewayAdapter,
    topic: string,
    payload: Buffer,
    retained: boolean,
  ): Promise<void> {
    // The gateway may have been revoked while the message waited.
    if (!this.subscriptions.has(gatewayId)) return;
    for (const event of adapter.translate({ gatewayId, topic, payload })) {
      // … or while an event before was applied.
      if (!this.subscriptions.has(gatewayId)) return;
      await this.apply(gatewayId, adapter, event, retained);
    }
  }

  private async apply(
    gatewayId: string,
    adapter: GatewayAdapter,
    event: AdapterEvent,
    retained: boolean,
  ): Promise<void> {
    switch (event.type) {
      case 'hardware.listed':
        return this.onListed(gatewayId, event.hardware);
      case 'hardware.joined':
        return this.onJoined(gatewayId, event.externalId, event.address, event.name);
      case 'hardware.setup':
        return this.onSetup(gatewayId, event.externalId, event.setupState);
      case 'hardware.left':
        return this.onLeft(gatewayId, event.externalId);
      case 'hardware.readdressed':
        return this.onReaddressed(gatewayId, event.from, event.to, event.name);
      case 'hardware.availability':
        return this.onAvailability(gatewayId, event.ref, event.availability);
      case 'hardware.report':
        return this.onReport(gatewayId, adapter, event.ref, event.native, retained);
      case 'activity':
        // A retained message is a replay on subscribing, not a sign that the gateway is alive.
        if (!retained) await this.onActivity(gatewayId);
        return;
    }
  }

  private async onListed(gatewayId: string, listed: ReportedHardware[]): Promise<void> {
    const { ids } = await this.hardware.replaceListed(gatewayId, listed, this.clock());
    for (const hardwareId of ids) this.announceHardware(hardwareId);
    const addresses = await this.hardware.listAddresses(gatewayId);
    if (!this.subscriptions.has(gatewayId)) return;
    this.addresses.replace(gatewayId, addresses);
    for (const { id, address } of addresses) {
      const key = this.pendingKey(gatewayId, address);
      const availability = this.pendingAvailability.get(key);
      if (availability === undefined) continue;
      this.pendingAvailability.delete(key);
      await this.recordAvailability(id, availability);
    }
  }

  private async onJoined(
    gatewayId: string,
    externalId: string,
    address: string | null,
    name: string,
  ): Promise<void> {
    const id = await this.hardware.recordJoined(gatewayId, externalId, address, name, this.clock());
    // The gateway may have been revoked while the row was written.
    if (address !== null && this.subscriptions.has(gatewayId)) {
      this.addresses.set(gatewayId, address, id);
    }
    this.announceHardware(id);
  }

  private async onSetup(gatewayId: string, externalId: string, state: SetupState): Promise<void> {
    const id = await this.hardware.setSetupState(gatewayId, externalId, state);
    if (id !== undefined) this.announceHardware(id);
  }

  private async onLeft(gatewayId: string, externalId: string): Promise<void> {
    const gone = await this.hardware.markLeft(gatewayId, externalId, this.clock());
    if (!gone) return;
    if (gone.address !== null) this.addresses.remove(gatewayId, gone.address);
    this.announceHardware(gone.id);
  }

  private async onReaddressed(
    gatewayId: string,
    from: string,
    to: string,
    name: string,
  ): Promise<void> {
    const id = await this.hardware.readdress(gatewayId, from, to, name);
    if (id === undefined) return;
    if (this.subscriptions.has(gatewayId)) this.addresses.move(gatewayId, from, to, id);
    this.announceHardware(id);
  }

  private async onAvailability(
    gatewayId: string,
    ref: HardwareRef,
    availability: Availability,
  ): Promise<void> {
    if ('externalId' in ref) {
      const hardwareId = await this.resolve(gatewayId, ref);
      if (hardwareId !== undefined) await this.recordAvailability(hardwareId, availability);
      return;
    }
    const hardwareId = this.addresses.lookup(gatewayId, ref.address);
    if (hardwareId !== undefined) return this.recordAvailability(hardwareId, availability);
    // The retained availability can arrive before the hardware list: keep it for when that does.
    const key = this.pendingKey(gatewayId, ref.address);
    this.pendingAvailability.delete(key);
    this.pendingAvailability.set(key, availability);
    if (this.pendingAvailability.size > MEMORY_LIMIT) {
      const oldest = this.pendingAvailability.keys().next();
      if (!oldest.done) this.pendingAvailability.delete(oldest.value);
    }
  }

  private async onReport(
    gatewayId: string,
    adapter: GatewayAdapter,
    ref: HardwareRef,
    native: unknown,
    retained: boolean,
  ): Promise<void> {
    const hardwareId = await this.resolve(gatewayId, ref);
    if (hardwareId === undefined) return;
    const receivedAt = this.clock();
    const capabilities = await this.hardware.capabilitiesOf(hardwareId);
    const { values, measuredAt } = adapter.decodeReport(native, capabilities);
    await this.processor.handle({
      gatewayId,
      hardwareId,
      values,
      measuredAt,
      receivedAt,
      retained,
      capabilities,
    });
  }

  /** The hardware a reference stands for; counted and `undefined` if the gateway has none such. */
  private async resolve(gatewayId: string, ref: HardwareRef): Promise<string | undefined> {
    const hardwareId =
      'externalId' in ref
        ? await this.hardware.findByExternalId(gatewayId, ref.externalId)
        : this.addresses.lookup(gatewayId, ref.address);
    if (hardwareId === undefined) {
      const [label, value] =
        'externalId' in ref ? ['external ID', ref.externalId] : ['address', ref.address];
      const shown = JSON.stringify(value.slice(0, MAX_ADDRESS_LOG));
      this.discard('unknownName', gatewayId, `unknown ${label} ${shown}`);
    }
    return hardwareId;
  }

  /** Notes that the gateway is alive, at most once a minute; a failure costs only the note. */
  private async onActivity(gatewayId: string): Promise<void> {
    if (!this.touches.allow(gatewayId, this.clock())) return;
    try {
      await this.gateways.touch(gatewayId, this.clock());
    } catch (error) {
      if (this.failures.allow('touch', this.clock())) {
        this.logger.warn(`Cannot note a sign of life of ${gatewayId}: ${describeError(error)}`);
      }
    }
  }

  /** Stores the availability and announces the hardware and the devices that sit on it. */
  private async recordAvailability(hardwareId: string, availability: Availability): Promise<void> {
    const devices = await this.hardware.setAvailability(hardwareId, availability);
    this.announceHardware(hardwareId);
    for (const { deviceId, householdId } of devices) {
      this.deviceEvents.emit(DEVICE_CHANGED, { householdId, deviceId } satisfies DeviceChanged);
    }
  }

  private announceHardware(hardwareId: string): void {
    this.deviceEvents.emit(HARDWARE_CHANGED, { hardwareId } satisfies HardwareChanged);
  }

  private pendingKey(gatewayId: string, address: string): string {
    return `${gatewayId}\0${address}`;
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
