import {
  GATEWAY_OFFLINE_MINUTES,
  SEVERITY_OF,
  type AttentionItem,
  type AttentionKind,
  type Availability,
  type DeviceKind,
  type EffectiveThresholds,
  type GatewayStatus,
  type GatewayWarning,
} from '@smart/contracts';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** What a value must move beyond its threshold before the item ends (percentage points). */
export const SOIL_HYSTERESIS = 3;
export const BATTERY_HYSTERESIS = 5;
/** A certificate or the CRL counts as expiring this long before it ends. */
const EXPIRY_WARNING_DAYS = 30;

export interface GatewaySnapshot {
  id: string;
  name: string;
  bridgeStatus: GatewayStatus;
  z2mStatus: GatewayStatus;
  statusChangedAt: Date | null;
  lastMessageAt: Date | null;
  certExpiresAt: Date;
  warnings: readonly GatewayWarning[];
}

export interface DeviceSnapshot {
  id: string;
  name: string;
  gatewayId: string;
  kind: DeviceKind;
  thresholds: EffectiveThresholds;
  availability: Availability;
  lastSeenAt: Date | null;
  createdAt: Date;
  /** `soil_moisture`, `dry`, `battery`, `contact`, … as the device reported them. */
  state: Readonly<Record<string, unknown>>;
}

/** Hardware of the household's gateways that is not part of a device yet. */
export interface HardwareSnapshot {
  id: string;
  gatewayId: string;
  name: string;
  firstSeenAt: Date;
}

/** Everything the rules need to know about one household. */
export interface Snapshot {
  gateways: readonly GatewaySnapshot[];
  devices: readonly DeviceSnapshot[];
  hardware: readonly HardwareSnapshot[];
  /** When the CRL must be renewed; `null` when unknown. */
  crlNextUpdate: Date | null;
}

/** What the household had before: the items (for `since` and hysteresis) and when doors opened. */
export interface Previous {
  items: readonly AttentionItem[];
  /** Per device the time its contact was first seen open, while it stays open. */
  contactOpenSince?: ReadonlyMap<string, Date>;
}

export const NOTHING_BEFORE: Previous = { items: [] };

/** Appends an item; `since` is the fallback when the item did not exist before. */
type Add = (
  kind: AttentionKind,
  subject: string,
  since: Date,
  item: Omit<AttentionItem, 'id' | 'kind' | 'severity' | 'since' | 'params'> & {
    params?: Record<string, unknown>;
  },
) => void;

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 } as const;

/** Most urgent first, then newest first; the ID keeps the order stable. */
export function compareItems(a: AttentionItem, b: AttentionItem): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    b.since.localeCompare(a.since) ||
    a.id.localeCompare(b.id)
  );
}

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const isTrue = (value: unknown): boolean => value === true || value === 'ON';

/** Zigbee2MQTT reports `contact: false` while the contact is open. */
const isOpen = (state: Readonly<Record<string, unknown>>): boolean => state['contact'] === false;

const minutesBetween = (from: Date, to: Date): number =>
  (to.getTime() - from.getTime()) / MINUTE_MS;

const earlier = (date: Date | null, now: Date): Date =>
  date !== null && date.getTime() < now.getTime() ? date : now;

function gatewayIsOffline(gateway: GatewaySnapshot, now: Date): boolean {
  if (gateway.bridgeStatus === 'online' && gateway.z2mStatus === 'online') return false;
  // Nothing was ever heard from it: there is no time to count the minutes from.
  const since = gateway.statusChangedAt ?? gateway.lastMessageAt;
  return since !== null && minutesBetween(since, now) >= GATEWAY_OFFLINE_MINUTES;
}

/**
 * When each currently open contact was first seen open: kept from before while it stays open,
 * else the time of its last message (the report that opened it, or the best known lower bound).
 */
export function openContacts(snapshot: Snapshot, previous: Previous, now: Date): Map<string, Date> {
  const open = new Map<string, Date>();
  for (const device of snapshot.devices) {
    if (!isOpen(device.state)) continue;
    open.set(
      device.id,
      previous.contactOpenSince?.get(device.id) ?? earlier(device.lastSeenAt, now),
    );
  }
  return open;
}

/**
 * The household's attention items for the state it is in at `now` (spec 4.1 to 4.4).
 *
 * - A gateway that is not online for 5 minutes yields one critical item; its devices yield none.
 * - A device is silent only while its gateway is online, and then yields nothing else.
 * - An item keeps the `since` of the same item in `previous` while its condition holds, and the
 *   soil and battery items end only beyond the hysteresis margin.
 * - Otherwise `since` is when the condition's cause began: the gateway's last status change, the
 *   device's last report, when the contact was first seen open, when the hardware was discovered.
 *
 * Pure: no clock, no I/O. Sorted by urgency, then newest first; role filtering is the service's job.
 */
export function evaluate(snapshot: Snapshot, previous: Previous, now: Date): AttentionItem[] {
  const before = new Map(previous.items.map((item) => [item.id, item]));
  const items: AttentionItem[] = [];
  const add: Add = (kind, subject, since, item) => {
    const id = `${kind}:${subject}`;
    items.push({
      ...item,
      id,
      kind,
      severity: SEVERITY_OF[kind],
      since: (before.has(id) ? new Date(before.get(id)?.since ?? since) : since).toISOString(),
      params: item.params ?? {},
    });
  };

  const offline = new Set<string>();
  for (const gateway of snapshot.gateways) {
    if (!gatewayIsOffline(gateway, now)) continue;
    offline.add(gateway.id);
    const since = gateway.statusChangedAt ?? gateway.lastMessageAt ?? now;
    const affected = snapshot.devices.filter((device) => device.gatewayId === gateway.id);
    add('gateway_offline', gateway.id, since, {
      gatewayId: gateway.id,
      name: gateway.name,
      params: {
        affectedDevices: affected.length,
        bridgeStatus: gateway.bridgeStatus,
        z2mStatus: gateway.z2mStatus,
      },
    });
  }

  // Only a gateway that is online vouches for its devices' silence; during the grace period of a
  // gateway that is not online yet (a restart) its devices say nothing.
  const online = new Set(
    snapshot.gateways
      .filter((gateway) => gateway.bridgeStatus === 'online' && gateway.z2mStatus === 'online')
      .map((gateway) => gateway.id),
  );
  const open = openContacts(snapshot, previous, now);
  for (const device of snapshot.devices) {
    if (offline.has(device.gatewayId)) continue;
    evaluateDevice(device, now, before, open.get(device.id), online.has(device.gatewayId), add);
  }

  for (const hardware of snapshot.hardware) {
    add('hardware_new', hardware.id, hardware.firstSeenAt, {
      gatewayId: hardware.gatewayId,
      name: hardware.name,
    });
  }

  evaluateCertificates(snapshot, now, add);
  return items.sort(compareItems);
}

function evaluateDevice(
  device: DeviceSnapshot,
  now: Date,
  before: ReadonlyMap<string, AttentionItem>,
  openSince: Date | undefined,
  gatewayOnline: boolean,
  add: Add,
): void {
  const { thresholds, state } = device;
  const base = { deviceId: device.id, gatewayId: device.gatewayId, name: device.name };
  const reported = earlier(device.lastSeenAt, now);

  // Silent: the hardware says it is gone, or nothing was heard for longer than the threshold.
  const lastHeard = device.lastSeenAt ?? device.createdAt;
  const silentFor = minutesBetween(lastHeard, now);
  const unavailable = device.availability === 'offline';
  const quiet = silentFor >= thresholds.silentMinutes;
  if (gatewayOnline && (unavailable || quiet)) {
    add('device_silent', device.id, earlier(lastHeard, now), {
      ...base,
      params: {
        reason: unavailable ? 'unavailable' : 'no_message',
        silentMinutes: thresholds.silentMinutes,
      },
    });
    // Its values are stale: the silence is the cause, like an offline gateway (spec 4.1, rule 3).
    // Only a low battery stays, because an empty battery is the likely reason (Till, #36).
    evaluateBattery(device, before, reported, base, add);
    return;
  }

  const moisture = finite(state['soil_moisture']);
  const { soilMoistureMin: min, soilMoistureMax: max } = thresholds;
  const dryFlag = isTrue(state['dry']);
  const wasDry = before.has(`soil_dry:${device.id}`);
  // The sensor's own "dry" flag fires at its level, not the user's: it only counts while the
  // device reports no moisture number. Otherwise the thresholds and the hysteresis decide.
  const isDry =
    moisture === undefined
      ? dryFlag
      : min !== null && (moisture < min || (wasDry && moisture < min + SOIL_HYSTERESIS));
  if (isDry) {
    add('soil_dry', device.id, reported, {
      ...base,
      ...(moisture !== undefined && { value: moisture, unit: '%' }),
      params: { dryFlag, ...(min !== null && { threshold: min }) },
    });
  }

  const wasWet = before.has(`soil_wet:${device.id}`);
  if (
    moisture !== undefined &&
    max !== null &&
    (moisture > max || (wasWet && moisture > max - SOIL_HYSTERESIS))
  ) {
    add('soil_wet', device.id, reported, {
      ...base,
      value: moisture,
      unit: '%',
      params: { threshold: max },
    });
  }

  evaluateBattery(device, before, reported, base, add);

  if (openSince !== undefined && minutesBetween(openSince, now) >= thresholds.contactOpenMinutes) {
    add('contact_open', device.id, openSince, {
      ...base,
      params: { openMinutes: Math.floor(minutesBetween(openSince, now)) },
    });
  }
}

/** `battery_low` from the last known battery value, with hysteresis. */
function evaluateBattery(
  device: DeviceSnapshot,
  before: ReadonlyMap<string, AttentionItem>,
  since: Date,
  base: { deviceId: string; gatewayId: string; name: string },
  add: Add,
): void {
  const battery = finite(device.state['battery']);
  const { batteryMin } = device.thresholds;
  const wasLow = before.has(`battery_low:${device.id}`);
  if (
    battery !== undefined &&
    (battery < batteryMin || (wasLow && battery < batteryMin + BATTERY_HYSTERESIS))
  ) {
    add('battery_low', device.id, since, {
      ...base,
      value: battery,
      unit: '%',
      params: { threshold: batteryMin },
    });
  }
}

function evaluateCertificates(snapshot: Snapshot, now: Date, add: Add): void {
  for (const gateway of snapshot.gateways) {
    const expired = gateway.warnings.includes('certExpired');
    if (!expired && !gateway.warnings.includes('certExpiring')) continue;
    add(
      'cert_expiring',
      gateway.id,
      new Date(gateway.certExpiresAt.getTime() - EXPIRY_WARNING_DAYS * DAY_MS),
      {
        gatewayId: gateway.id,
        name: gateway.name,
        params: { subject: 'certificate', expiresAt: gateway.certExpiresAt.toISOString(), expired },
      },
    );
  }
  const crl = snapshot.crlNextUpdate;
  if (crl !== null && snapshot.gateways.some((g) => g.warnings.includes('crlExpiring'))) {
    add('cert_expiring', 'crl', new Date(crl.getTime() - EXPIRY_WARNING_DAYS * DAY_MS), {
      name: 'CRL',
      params: {
        subject: 'crl',
        expiresAt: crl.toISOString(),
        expired: crl.getTime() <= now.getTime(),
      },
    });
  }
}
