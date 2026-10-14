import { deviceSchema, hardwareSchema } from '@smart/contracts';
import { toDevice, toHardware } from './devices.service.js';
import type { DeviceView } from './devices.repository.js';
import type { HardwareWithCapabilities } from './hardware.repository.js';

const SEEN = new Date('2026-10-14T11:00:00.000Z');

describe('the contract shapes of devices and hardware', () => {
  it('turns dates into ISO strings and keeps empty values as null', () => {
    const view: DeviceView = {
      id: 'd1',
      name: 'Bed',
      icon: null,
      createdAt: SEEN,
      hardware: { id: 'h1', vendor: 'Acme', model: 'AY', description: null },
      availability: 'online',
      lastSeenAt: SEEN,
      state: { soil_moisture: 41 },
      capabilities: [],
    };
    const device = toDevice(view);
    expect(deviceSchema.parse(device)).toEqual(device);
    expect(device.lastSeenAt).toBe('2026-10-14T11:00:00.000Z');
    expect(device).not.toHaveProperty('createdAt');
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
