import { deviceSchema, hardwareSchema } from '@smart/contracts';
import {
  DEVICE_CHANGED,
  DEVICE_THRESHOLDS_CHANGED,
  DeviceEvents,
  HARDWARE_CHANGED,
} from './device-events.js';
import type { DeviceView, DevicesRepository } from './devices.repository.js';
import { DevicesService, mergeThresholds, toDevice, toHardware } from './devices.service.js';
import type { HardwareRepository, HardwareWithCapabilities } from './hardware.repository.js';

const SEEN = new Date('2026-10-14T11:00:00.000Z');

describe('the contract shapes of devices and hardware', () => {
  it('turns dates into ISO strings and keeps empty values as null', () => {
    const view: DeviceView = {
      id: 'd1',
      name: 'Bed',
      icon: null,
      createdAt: SEEN,
      hardware: { id: 'h1', vendor: 'Acme', model: 'AY', description: null },
      gatewayId: 'gw-a1b2c3d4',
      availability: 'online',
      lastSeenAt: SEEN,
      state: { soil_moisture: 41 },
      capabilities: [],
      kind: 'soil',
      thresholds: { batteryMin: 10 },
    };
    const device = toDevice(view);
    expect(deviceSchema.parse(device)).toEqual(device);
    expect(device.lastSeenAt).toBe('2026-10-14T11:00:00.000Z');
    expect(device).not.toHaveProperty('createdAt');
    expect(device.kind).toBe('soil');
    expect(device.thresholds).toEqual({ batteryMin: 10 });
    expect(device.effectiveThresholds).toMatchObject({ soilMoistureMin: 25, batteryMin: 10 });
    expect(toDevice({ ...view, lastSeenAt: null })).toMatchObject({ lastSeenAt: null, icon: null });
  });

  it('maps hardware without the stored internals', () => {
    const row = {
      id: 'h1',
      gatewayId: 'gw-a1b2c3d4',
      ieeeAddress: '0x00124b0001',
      friendlyName: 'bed-1',
      vendor: 'Acme',
      model: 'AY',
      description: null,
      definition: { secret: 'internal' },
      interviewState: 'SUCCESSFUL',
      availability: 'unknown',
      lastState: {},
      firstSeenAt: SEEN,
      lastSeenAt: null,
      removedAt: null,
      capabilities: [],
    } satisfies HardwareWithCapabilities;
    const mapped = toHardware(row);
    expect(hardwareSchema.parse(mapped)).toEqual(mapped);
    expect(mapped.lastSeenAt).toBeNull();
    expect(mapped).not.toHaveProperty('definition');
  });
});

describe('mergeThresholds', () => {
  it('overwrites set values, removes null ones and keeps the rest', () => {
    expect(
      mergeThresholds(
        { batteryMin: 10, silentMinutes: 30, soilMoistureMin: 20 },
        { batteryMin: null, silentMinutes: 60, soilMoistureMax: 90 },
      ),
    ).toEqual({ silentMinutes: 60, soilMoistureMin: 20, soilMoistureMax: 90 });
  });

  it('leaves the stored value alone for a missing field', () => {
    expect(mergeThresholds({ batteryMin: 10 }, {})).toEqual({ batteryMin: 10 });
  });
});

describe('DevicesService events', () => {
  const HOUSEHOLD = '3c1d5f77-0a2b-4e8c-b6d9-2f4a8e0c1b33';
  const HARDWARE = '0b6f3a8e-1c47-4d2a-8c11-5f0a9b7d3e21';
  const DEVICE = '7d2c9e10-4b5a-4f3e-9a8d-1e6b0c2f4a55';
  const view: DeviceView = {
    id: DEVICE,
    name: 'Bed',
    icon: null,
    createdAt: SEEN,
    hardware: { id: HARDWARE, vendor: 'Acme', model: 'AY', description: null },
    gatewayId: 'gw-a1b2c3d4',
    availability: 'online',
    lastSeenAt: SEEN,
    state: {},
    capabilities: [],
    kind: 'soil',
    thresholds: {},
  };
  const createWithBinding = vi.fn<DevicesRepository['createWithBinding']>();
  const get = vi.fn<DevicesRepository['get']>();
  const update = vi.fn<DevicesRepository['update']>();
  let events: DeviceEvents;
  let log: [string, unknown][];
  let service: DevicesService;

  beforeEach(() => {
    for (const mock of [createWithBinding, get, update]) mock.mockReset();
    get.mockResolvedValue(view);
    events = new DeviceEvents();
    log = [];
    for (const name of [DEVICE_CHANGED, HARDWARE_CHANGED, DEVICE_THRESHOLDS_CHANGED]) {
      events.on(name, (event) => log.push([name, event]));
    }
    service = new DevicesService(
      {} as unknown as HardwareRepository,
      { createWithBinding, get, update } as unknown as DevicesRepository,
      events,
    );
  });

  it('announces the new device and the hardware that is assigned now', async () => {
    createWithBinding.mockResolvedValue({
      outcome: 'created',
      device: { id: DEVICE } as never,
    });
    await service.create(HOUSEHOLD, { hardwareId: HARDWARE, name: 'Bed' });
    expect(log).toEqual([
      [DEVICE_CHANGED, { householdId: HOUSEHOLD, deviceId: DEVICE }],
      [HARDWARE_CHANGED, { hardwareId: HARDWARE }],
    ]);
  });

  it('announces nothing when the device was not created', async () => {
    createWithBinding.mockResolvedValue({ outcome: 'hardware-bound' });
    await expect(
      service.create(HOUSEHOLD, { hardwareId: HARDWARE, name: 'Bed' }),
    ).rejects.toThrow();
    expect(log).toEqual([]);
  });

  it('announces the device after every successful update', async () => {
    update.mockResolvedValue({ view, thresholdsChanged: false });
    await service.update(HOUSEHOLD, DEVICE, { name: 'Renamed' });
    expect(log).toEqual([[DEVICE_CHANGED, { householdId: HOUSEHOLD, deviceId: DEVICE }]]);
  });

  it('announces nothing for an update of an unknown device', async () => {
    update.mockResolvedValue(undefined);
    await expect(service.update(HOUSEHOLD, DEVICE, { name: 'Renamed' })).rejects.toThrow();
    expect(log).toEqual([]);
  });
});
