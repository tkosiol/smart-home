import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  effectiveThresholds,
  hasRole,
  type AttentionItem,
  type HouseholdRole,
} from '@smart/contracts';
import { describeError } from '../../platform/errors/index.js';
import {
  DEVICE_STATE_CHANGED,
  DEVICE_THRESHOLDS_CHANGED,
  DeviceEvents,
  DevicesRepository,
  HardwareRepository,
  type DeviceStateChanged,
  type DeviceThresholdsChanged,
  type DeviceView,
} from '../devices/index.js';
import {
  GATEWAY_REGISTERED,
  GATEWAY_REVOKED,
  GATEWAY_STATUS_CHANGED,
  GatewayEvents,
  GatewaysService,
  type GatewayStatusChanged,
} from '../gateways/index.js';
import { CLOCK, type Clock } from '../identity/index.js';
import { evaluate, openContacts, type DeviceSnapshot, type Snapshot } from './attention.rules.js';

/** How often the time conditions (open too long, silent, gateway away) are looked at again. */
export const TICK_MS = 30_000;

interface HouseholdState {
  snapshot: Snapshot;
  items: AttentionItem[];
  contactOpenSince: Map<string, Date>;
}

const toDeviceSnapshot = (view: DeviceView): DeviceSnapshot => ({
  id: view.id,
  name: view.name,
  gatewayId: view.gatewayId,
  kind: view.kind,
  thresholds: effectiveThresholds(view.kind, view.thresholds),
  availability: view.availability,
  lastSeenAt: view.lastSeenAt,
  createdAt: view.createdAt,
  state: view.state,
});

/** What a role may see: new hardware is the owner's business, certificates also the admin's. */
function visibleTo(item: AttentionItem, role: HouseholdRole, isPlatformAdmin: boolean): boolean {
  if (item.kind === 'hardware_new') return hasRole(role, 'owner');
  if (item.kind === 'cert_expiring') return hasRole(role, 'owner') || isPlatformAdmin;
  return true;
}

/**
 * The attention items of every household, held in memory (they follow from the state and are not
 * stored). They are recomputed when the service starts, when a device reports or a gateway changes
 * status, when thresholds change, and every 30 seconds for the conditions that depend on time.
 * Recomputations run one after the other; a failing one is logged and never reaches the emitter
 * of the event that triggered it.
 */
@Injectable()
export class AttentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttentionService.name);
  private readonly households = new Map<string, HouseholdState>();
  private readonly queued = new Set<string>();
  private tail: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly gateways: GatewaysService,
    private readonly devices: DevicesRepository,
    private readonly hardware: HardwareRepository,
    private readonly gatewayEvents: GatewayEvents,
    private readonly deviceEvents: DeviceEvents,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async onModuleInit(): Promise<void> {
    this.gatewayEvents.on(GATEWAY_STATUS_CHANGED, this.onGatewayStatus);
    this.gatewayEvents.on(GATEWAY_REGISTERED, this.onGatewaysChanged);
    this.gatewayEvents.on(GATEWAY_REVOKED, this.onGatewaysChanged);
    this.deviceEvents.on(DEVICE_STATE_CHANGED, this.onDeviceState);
    this.deviceEvents.on(DEVICE_THRESHOLDS_CHANGED, this.onThresholds);
    try {
      await this.refreshAll();
    } catch (error) {
      this.logger.warn(`Cannot compute the attention items at start: ${describeError(error)}`);
    }
    this.timer = setInterval(() => this.fire('tick', () => this.refreshAll()), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.gatewayEvents.off(GATEWAY_STATUS_CHANGED, this.onGatewayStatus);
    this.gatewayEvents.off(GATEWAY_REGISTERED, this.onGatewaysChanged);
    this.gatewayEvents.off(GATEWAY_REVOKED, this.onGatewaysChanged);
    this.deviceEvents.off(DEVICE_STATE_CHANGED, this.onDeviceState);
    this.deviceEvents.off(DEVICE_THRESHOLDS_CHANGED, this.onThresholds);
  }

  /** The household's items for the role, most urgent first, then newest first. */
  list(householdId: string, role: HouseholdRole, isPlatformAdmin: boolean): AttentionItem[] {
    const items = this.households.get(householdId)?.items ?? [];
    return items.filter((item) => visibleTo(item, role, isPlatformAdmin));
  }

  /** Computes the household's items if that has not happened yet (a household unknown so far). */
  async ensureComputed(householdId: string): Promise<void> {
    if (!this.households.has(householdId)) await this.recomputeHousehold(householdId);
  }

  /** Reads the household's state anew and recomputes its items. */
  recomputeHousehold(householdId: string): Promise<void> {
    return this.serial(() => this.reload(householdId));
  }

  /** Reads one device anew (after it reported or its thresholds changed) and recomputes. */
  recomputeDevice(householdId: string, deviceId: string): Promise<void> {
    return this.serial(() => this.reloadDevice(householdId, deviceId));
  }

  private async reloadDevice(householdId: string, deviceId: string): Promise<void> {
    const state = this.households.get(householdId);
    if (!state) return this.reload(householdId);
    const view = await this.devices.get(householdId, deviceId);
    const others = state.snapshot.devices.filter((device) => device.id !== deviceId);
    const devices = view ? [...others, toDeviceSnapshot(view)] : others;
    this.apply(householdId, { ...state.snapshot, devices });
  }

  /** Resolves when the recomputations requested so far are done. */
  async idle(): Promise<void> {
    await this.tail;
  }

  /** Reloads every household that has a gateway, and those known already. */
  private async refreshAll(): Promise<void> {
    const ids = new Set(this.households.keys());
    for (const gateway of await this.gateways.listActive()) ids.add(gateway.householdId);
    for (const id of ids) {
      try {
        await this.reload(id);
      } catch (error) {
        this.logger.warn(
          `Cannot compute the attention items of a household: ${describeError(error)}`,
        );
      }
    }
  }

  private async reload(householdId: string): Promise<void> {
    const [gateways, devices, hardware] = await Promise.all([
      this.gateways.list(householdId),
      this.devices.list(householdId),
      this.hardware.listUnassigned(householdId),
    ]);
    const active = gateways.filter((gateway) => gateway.revokedAt === null);
    const crlWarned = active.some((gateway) => gateway.warnings.includes('crlExpiring'));
    const crlNextUpdate = crlWarned ? ((await this.gateways.crlNextUpdate()) ?? null) : null;
    const known = new Set(active.map((gateway) => gateway.id));
    this.apply(householdId, {
      gateways: active.map((gateway) => ({
        id: gateway.id,
        name: gateway.name,
        bridgeStatus: gateway.bridgeStatus,
        z2mStatus: gateway.z2mStatus,
        statusChangedAt:
          gateway.statusChangedAt === null ? null : new Date(gateway.statusChangedAt),
        lastMessageAt: gateway.lastMessageAt === null ? null : new Date(gateway.lastMessageAt),
        certExpiresAt: new Date(gateway.certExpiresAt),
        warnings: gateway.warnings,
      })),
      // Devices of a revoked gateway cannot report any more; they are not worth a warning.
      devices: devices.filter((view) => known.has(view.gatewayId)).map(toDeviceSnapshot),
      hardware: hardware.map((row) => ({
        id: row.id,
        gatewayId: row.gatewayId,
        name: row.friendlyName,
        firstSeenAt: row.firstSeenAt,
      })),
      crlNextUpdate,
    });
  }

  private apply(householdId: string, snapshot: Snapshot): void {
    const now = this.clock();
    const previous = this.households.get(householdId);
    const before = { items: previous?.items ?? [], contactOpenSince: previous?.contactOpenSince };
    this.households.set(householdId, {
      snapshot,
      items: evaluate(snapshot, before, now),
      contactOpenSince: openContacts(snapshot, before, now),
    });
  }

  private householdOfGateway(gatewayId: string): string | undefined {
    for (const [id, state] of this.households) {
      if (state.snapshot.gateways.some((gateway) => gateway.id === gatewayId)) return id;
    }
    return undefined;
  }

  private householdOfDevice(deviceId: string): string | undefined {
    for (const [id, state] of this.households) {
      if (state.snapshot.devices.some((device) => device.id === deviceId)) return id;
    }
    return undefined;
  }

  // The listeners run inside the emitter of the module that announces the event, often right
  // after it stored a change: whatever goes wrong here must never reach that module.
  private readonly onGatewayStatus = (event: GatewayStatusChanged): void =>
    this.listen(() => {
      const householdId = this.householdOfGateway(event.gatewayId);
      if (householdId === undefined) this.fire('all', () => this.refreshAll());
      else this.fire(`h:${householdId}`, () => this.reload(householdId));
    });

  private readonly onGatewaysChanged = (): void =>
    this.listen(() => this.fire('all', () => this.refreshAll()));

  private readonly onDeviceState = (event: DeviceStateChanged): void =>
    this.listen(() => {
      const householdId = this.householdOfDevice(event.deviceId);
      // A device not seen yet (just created) is found by the next tick.
      if (householdId === undefined) return;
      this.fire(`d:${event.deviceId}`, () => this.reloadDevice(householdId, event.deviceId));
    });

  private readonly onThresholds = (event: DeviceThresholdsChanged): void =>
    this.listen(() =>
      this.fire(`d:${event.deviceId}`, () => this.reloadDevice(event.householdId, event.deviceId)),
    );

  private listen(handler: () => void): void {
    try {
      handler();
    } catch (error) {
      this.logger.warn(`Cannot handle an event for the attention items: ${describeError(error)}`);
    }
  }

  /** Runs the task in its turn unless the same one is waiting already; a failure is only logged. */
  private fire(key: string, task: () => Promise<void>): void {
    if (this.queued.has(key)) return;
    this.queued.add(key);
    this.serial(() => {
      this.queued.delete(key);
      return task();
    }).catch((error: unknown) => {
      this.logger.warn(`Cannot recompute the attention items: ${describeError(error)}`);
    });
  }

  /** Runs the task after the ones before it; the chain goes on when the task fails. */
  private serial(task: () => Promise<void>): Promise<void> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
