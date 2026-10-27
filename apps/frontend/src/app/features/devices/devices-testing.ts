import {
  RESOLUTION_MINUTES,
  effectiveThresholds,
  type Capability,
  type Device,
  type DeviceHistory,
  type DeviceUpdate,
  type Hardware,
  type HistoryDay,
  type HistoryPoint,
  type HistoryRange,
  type Thresholds,
} from '@smart/contracts';
import { apiError, json } from '../../testing/auth-testing';
import type { RecordedCall } from '../../testing/household-page-testing';

export const capability = (key: string, overrides: Partial<Capability> = {}): Capability => ({
  key,
  kind: 'numeric',
  unit: null,
  min: null,
  max: null,
  step: null,
  enumValues: null,
  readable: true,
  writable: false,
  isSetting: false,
  ...overrides,
});

export const moisture = capability('soil_moisture', { unit: '%' });
export const temperature = capability('temperature', { unit: '°C' });
export const battery = capability('battery', { unit: '%' });
export const linkquality = capability('linkquality');
export const dry = capability('dry', { kind: 'binary' });

export const device = (id: string, name: string, overrides: Partial<Device> = {}): Device => ({
  id,
  name,
  icon: null,
  hardware: { id: `hw-${id}`, vendor: 'Acme', model: 'SM-1', description: 'Soil moisture sensor' },
  availability: 'online',
  lastSeenAt: '2026-10-14T11:55:00Z',
  state: { soil_moisture: 41.26, temperature: 21.5, battery: 87, linkquality: 120, dry: false },
  capabilities: [moisture, temperature, battery, linkquality, dry],
  kind: 'soil',
  thresholds: {},
  effectiveThresholds: {
    soilMoistureMin: 25,
    soilMoistureMax: null,
    batteryMin: 20,
    contactOpenMinutes: 10,
    silentMinutes: 120,
  },
  ...overrides,
});

export const hardware = (id: string, friendlyName: string, overrides: Partial<Hardware> = {}) =>
  ({
    id,
    gatewayId: 'gw-aaaaaaaa',
    ieeeAddress: `0x${id}`,
    friendlyName,
    vendor: 'Acme',
    model: 'SM-1',
    description: null,
    availability: 'online',
    lastSeenAt: '2026-10-14T11:58:00Z',
    lastState: { soil_moisture: 37, soil_calibration: 5 },
    capabilities: [
      moisture,
      capability('soil_calibration', { isSetting: true }),
      capability('identify', { kind: 'enum', readable: false, writable: true }),
    ],
    ...overrides,
  }) satisfies Hardware;

/** What the server does with `PATCH`: a new name, thresholds merged in (`null` removes one). */
function applyUpdate(device: Device, update: DeviceUpdate): Device {
  const own: Thresholds = { ...device.thresholds };
  for (const [key, value] of Object.entries(update.thresholds ?? {})) {
    if (value === null) delete own[key as keyof Thresholds];
    else Object.assign(own, { [key]: value });
  }
  return {
    ...device,
    name: update.name ?? device.name,
    thresholds: own,
    effectiveThresholds: effectiveThresholds(device.kind, own),
  };
}

/** The end of every fake history: a few minutes after the device's last report. */
export const HISTORY_END = '2026-10-14T12:00:00Z';
const RANGE_BUCKETS: Record<HistoryRange, number> = { '24h': 96, '7d': 168, '28d': 672 };

/**
 * A history of `capability` over `range` ending at {@link HISTORY_END}: 15-minute buckets for 24 h,
 * hourly ones otherwise, `value(i)` the value of bucket `i` (oldest first); 28 days carry the
 * per-day values (Berlin days are not modelled: UTC dates, 24 buckets each).
 */
export function historyOf(
  capability: string,
  range: HistoryRange,
  value: (index: number, count: number) => number = (i) => 30 + (i % 10),
  unit: string | null = '%',
): DeviceHistory {
  const resolution = range === '24h' ? '15m' : '1h';
  const step = RESOLUTION_MINUTES[resolution] * 60_000;
  const count = RANGE_BUCKETS[range];
  const to = Date.parse(HISTORY_END);
  const from = to - count * step;
  const points: HistoryPoint[] = Array.from({ length: count }, (_, i) => {
    const avg = value(i, count);
    return {
      t: new Date(from + i * step).toISOString().replace('.000Z', 'Z'),
      avg,
      min: avg - 1,
      max: avg + 1,
      last: avg,
    };
  });
  const days: HistoryDay[] =
    range === '28d'
      ? Array.from({ length: 28 }, (_, d) => {
          const day = points.slice(d * 24, d * 24 + 24);
          const avgs = day.map((p) => p.avg);
          return {
            date: new Date(from + d * 24 * 3_600_000).toISOString().slice(0, 10),
            avg: avgs.reduce((a, b) => a + b, 0) / avgs.length,
            min: Math.min(...day.map((p) => p.min)),
            max: Math.max(...day.map((p) => p.max)),
            last: day.at(-1)!.last,
            partial: false,
          };
        })
      : [];
  return {
    capability,
    unit,
    range,
    resolution,
    from: new Date(from).toISOString().replace('.000Z', 'Z'),
    to: HISTORY_END,
    points,
    days,
  };
}

export interface DevicesServer {
  devices: Device[];
  hardware: Hardware[];
  /** The answer to a history request; defaults to {@link historyOf} with a gentle wave. */
  history?: (capability: string, range: HistoryRange) => DeviceHistory | Response;
  fail?: (call: RecordedCall) => Response | undefined;
}

/** A small stand-in for the device API of one household. */
export function devicesServer(householdId: string, initial: Partial<DevicesServer> = {}) {
  const state: DevicesServer = { devices: [], hardware: [], ...initial };
  const base = `/api/v1/households/${householdId}`;
  const respond = (call: RecordedCall): Response => {
    const failed = state.fail?.(call);
    if (failed) return failed;
    const path = call.path.replace(base, '');
    if (call.method === 'GET' && path === '/devices') return json(state.devices);
    if (call.method === 'GET' && path === '/hardware?state=unassigned') {
      return json(state.hardware);
    }
    const past = /^\/devices\/([^/]+)\/history\?capability=([^&]+)&range=(\w+)$/.exec(path);
    if (past && call.method === 'GET') {
      const capability = decodeURIComponent(past[2]!);
      const range = past[3] as HistoryRange;
      const answer = state.history?.(capability, range) ?? historyOf(capability, range);
      return answer instanceof Response ? answer : json(answer);
    }
    const one = /^\/devices\/([^/]+)$/.exec(path);
    const found = state.devices.find((entry) => entry.id === one?.[1]);
    if (one && call.method === 'GET') {
      return found ? json(found) : apiError('household.notFound', 404);
    }
    if (one && call.method === 'PATCH' && found) {
      const updated = applyUpdate(found, call.body as DeviceUpdate);
      state.devices = state.devices.map((entry) => (entry.id === found.id ? updated : entry));
      return json(updated);
    }
    if (call.method === 'POST' && path === '/devices') {
      const body = call.body as { hardwareId: string; name: string };
      const created = device(`dev-${body.hardwareId}`, body.name);
      state.devices = [...state.devices, created];
      state.hardware = state.hardware.filter((entry) => entry.id !== body.hardwareId);
      return json(created, 201);
    }
    return new Response(null, { status: 204 });
  };
  return { state, respond };
}
