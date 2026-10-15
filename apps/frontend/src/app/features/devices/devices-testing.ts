import type { Capability, Device, Hardware } from '@smart/contracts';
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

export interface DevicesServer {
  devices: Device[];
  hardware: Hardware[];
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
    const one = /^\/devices\/([^/]+)$/.exec(path);
    const found = state.devices.find((entry) => entry.id === one?.[1]);
    if (one && call.method === 'GET') {
      return found ? json(found) : apiError('household.notFound', 404);
    }
    if (one && call.method === 'PATCH' && found) {
      const renamed = { ...found, name: (call.body as { name: string }).name };
      state.devices = state.devices.map((entry) => (entry.id === found.id ? renamed : entry));
      return json(renamed);
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
