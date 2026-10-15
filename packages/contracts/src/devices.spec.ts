import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_KINDS,
  LOW_BATTERY_PERCENT,
  isLowBattery,
  capabilitySchema,
  deviceCreateSchema,
  deviceRenameSchema,
  deviceSchema,
  hardwareSchema,
  primaryCapability,
  deviceKind,
  DEVICE_KINDS,
  type Capability,
} from './devices.js';
import { API_ERROR_CODES } from './api-error.js';

function capability(overrides: Partial<Capability> & Pick<Capability, 'key' | 'kind'>): Capability {
  return {
    unit: null,
    min: null,
    max: null,
    step: null,
    enumValues: null,
    readable: true,
    writable: false,
    isSetting: false,
    ...overrides,
  };
}

const soilMoisture = capability({ key: 'soil_moisture', kind: 'numeric', unit: '%' });
const temperature = capability({ key: 'temperature', kind: 'numeric', unit: '°C' });
const humidity = capability({ key: 'humidity', kind: 'numeric', unit: '%' });
const dry = capability({ key: 'dry', kind: 'binary' });
const battery = capability({ key: 'battery', kind: 'numeric', unit: '%' });
const lampState = capability({ key: 'state', kind: 'binary', writable: true });
const brightness = capability({
  key: 'brightness',
  kind: 'numeric',
  min: 0,
  max: 254,
  writable: true,
});
const temperatureUnit = capability({
  key: 'temperature_unit',
  kind: 'enum',
  enumValues: ['celsius', 'fahrenheit'],
  writable: true,
  isSetting: true,
});
const temperatureCalibration = capability({
  key: 'temperature_calibration',
  kind: 'numeric',
  unit: '°C',
  min: -2,
  max: 2,
  step: 0.1,
  writable: true,
  isSetting: true,
});

describe('capabilitySchema', () => {
  it('lists the kinds', () => {
    expect(CAPABILITY_KINDS).toEqual(['numeric', 'binary', 'enum', 'text', 'composite']);
  });

  it('accepts a numeric measurement and a setting with a range', () => {
    expect(capabilitySchema.safeParse(soilMoisture).success).toBe(true);
    expect(capabilitySchema.safeParse(temperatureCalibration).success).toBe(true);
  });

  it('accepts an enum with its values', () => {
    expect(capabilitySchema.safeParse(temperatureUnit).success).toBe(true);
  });

  it('rejects an unknown kind and a missing flag', () => {
    expect(capabilitySchema.safeParse({ ...soilMoisture, kind: 'color' }).success).toBe(false);
    expect(capabilitySchema.safeParse({ ...soilMoisture, isSetting: undefined }).success).toBe(
      false,
    );
  });
});

describe('hardwareSchema', () => {
  const hardware = {
    id: '7d6e8f0a-1b2c-4d3e-8f4a-5b6c7d8e9f01',
    gatewayId: 'gw-sim00001',
    ieeeAddress: '0x00000000000000a1',
    friendlyName: 'Pflanze 1',
    vendor: 'AOYAN',
    model: 'AY-303Z',
    description: 'Soil moisture sensor',
    availability: 'online' as const,
    lastSeenAt: '2026-10-14T08:00:00.000Z',
    lastState: { soil_moisture: 41, temperature: 21.5, humidity: 55, battery: 87, dry: false },
    capabilities: [soilMoisture, temperature, temperatureUnit],
  };

  it('accepts a sensor with its last state', () => {
    expect(hardwareSchema.safeParse(hardware).success).toBe(true);
  });

  it('accepts nested objects and null inside the last state', () => {
    const parsed = hardwareSchema.safeParse({
      ...hardware,
      lastState: { color: { x: 0.45, y: 0.41 }, linkquality: null, update: { state: 'idle' } },
    });
    expect(parsed.success && parsed.data.lastState).toEqual({
      color: { x: 0.45, y: 0.41 },
      linkquality: null,
      update: { state: 'idle' },
    });
  });

  it('accepts hardware that was never seen and has no description', () => {
    const parsed = hardwareSchema.safeParse({
      ...hardware,
      description: null,
      availability: 'unknown',
      lastSeenAt: null,
      lastState: {},
      capabilities: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown availability and a bad gateway ID', () => {
    expect(hardwareSchema.safeParse({ ...hardware, availability: 'sleeping' }).success).toBe(false);
    expect(hardwareSchema.safeParse({ ...hardware, gatewayId: 'api' }).success).toBe(false);
  });
});

describe('deviceSchema', () => {
  const device = {
    id: '0b8f1c2d-3e4f-4a5b-9c6d-7e8f9a0b1c2d',
    name: 'Basilikum',
    icon: null,
    hardware: {
      id: '7d6e8f0a-1b2c-4d3e-8f4a-5b6c7d8e9f01',
      vendor: 'IKEA',
      model: 'LED1624G9',
      description: 'TRADFRI bulb E12/E14/E26/E27, color/white spectrum, globe, opal, 600 lm',
    },
    availability: 'online' as const,
    lastSeenAt: '2026-10-14T08:00:00.000Z',
    state: { state: 'ON', brightness: 200 },
    capabilities: [lampState, brightness],
  };

  it('accepts a lamp with an icon', () => {
    expect(deviceSchema.safeParse({ ...device, icon: 'lightbulb' }).success).toBe(true);
  });

  it('accepts nested objects and null inside the state', () => {
    const parsed = deviceSchema.safeParse({
      ...device,
      state: { state: 'ON', color: { x: 0.45, y: 0.41 }, color_temp: null },
    });
    expect(parsed.success && parsed.data.state).toEqual({
      state: 'ON',
      color: { x: 0.45, y: 0.41 },
      color_temp: null,
    });
  });

  it('accepts a device without icon, state and last contact', () => {
    const parsed = deviceSchema.safeParse({
      ...device,
      lastSeenAt: null,
      availability: 'unknown',
      state: {},
      capabilities: [],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a missing name and an unknown availability', () => {
    expect(deviceSchema.safeParse({ ...device, name: undefined }).success).toBe(false);
    expect(deviceSchema.safeParse({ ...device, availability: 'away' }).success).toBe(false);
  });
});

describe('deviceCreateSchema and deviceRenameSchema', () => {
  it('trims the name', () => {
    const created = deviceCreateSchema.safeParse({ hardwareId: 'abc', name: '  Basilikum  ' });
    expect(created.success && created.data.name).toBe('Basilikum');
    const renamed = deviceRenameSchema.safeParse({ name: '  Minze ' });
    expect(renamed.success && renamed.data.name).toBe('Minze');
  });

  it('rejects an empty name and a missing hardware', () => {
    expect(deviceCreateSchema.safeParse({ hardwareId: 'abc', name: ' ' }).success).toBe(false);
    expect(deviceCreateSchema.safeParse({ name: 'Basilikum' }).success).toBe(false);
    expect(deviceRenameSchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('primaryCapability', () => {
  it('picks soil moisture for a soil sensor', () => {
    const capabilities = [dry, temperature, humidity, soilMoisture, battery];
    expect(primaryCapability(capabilities)?.key).toBe('soil_moisture');
  });

  it('picks the state for a lamp', () => {
    expect(primaryCapability([brightness, lampState])?.key).toBe('state');
  });

  it('picks the temperature when it is the only known measurement', () => {
    expect(primaryCapability([battery, temperature])?.key).toBe('temperature');
  });

  it('prefers temperature over humidity', () => {
    expect(primaryCapability([humidity, temperature])?.key).toBe('temperature');
  });

  it('falls back to the first numeric capability', () => {
    const lux = capability({ key: 'illuminance', kind: 'numeric', unit: 'lx' });
    expect(primaryCapability([dry, battery, lux])?.key).toBe('battery');
  });

  it('ignores settings in the numeric fallback', () => {
    expect(primaryCapability([temperatureCalibration, battery])?.key).toBe('battery');
  });

  it('skips capabilities that cannot be read', () => {
    const writeOnly = capability({ key: 'soil_moisture', kind: 'numeric', readable: false });
    expect(primaryCapability([writeOnly, battery])?.key).toBe('battery');
    expect(primaryCapability([writeOnly])).toBeUndefined();
  });

  it('skips a setting that is named like a known key', () => {
    const setting = capability({ key: 'temperature', kind: 'numeric', isSetting: true });
    expect(primaryCapability([setting, humidity])?.key).toBe('humidity');
    expect(primaryCapability([setting])).toBeUndefined();
  });

  it('returns undefined without capabilities or without a numeric one', () => {
    expect(primaryCapability([])).toBeUndefined();
    expect(primaryCapability([dry, temperatureUnit])).toBeUndefined();
  });
});

describe('constants', () => {
  it('flags a battery below 20 percent as low', () => {
    expect(LOW_BATTERY_PERCENT).toBe(20);
    expect(isLowBattery(19)).toBe(true);
    expect(isLowBattery(0)).toBe(true);
    expect(isLowBattery(20)).toBe(false);
    expect(isLowBattery(21)).toBe(false);
  });

  it('does not flag a missing or malformed battery value', () => {
    expect(isLowBattery(undefined)).toBe(false);
    expect(isLowBattery(null)).toBe(false);
    expect(isLowBattery(Number.NaN)).toBe(false);
    expect(isLowBattery('15')).toBe(false);
  });

  it('lists the hardware-bound error code', () => {
    expect(API_ERROR_CODES).toContain('device.hardwareBound');
  });
});

describe('deviceKind', () => {
  const contact = capability({ key: 'contact', kind: 'binary' });
  const readOnlyState = capability({ key: 'state', kind: 'binary' });

  it('lists the kinds', () => {
    expect(DEVICE_KINDS).toEqual(['light', 'soil', 'climate', 'contact', 'other']);
  });

  it('recognises a light by a writable state or brightness', () => {
    expect(deviceKind([lampState])).toBe('light');
    expect(deviceKind([brightness, battery].map((c) => ({ ...c, writable: true })))).toBe('light');
  });

  it('does not treat a readable-only state as a light', () => {
    expect(deviceKind([readOnlyState])).toBe('other');
  });

  it('recognises soil, also with temperature', () => {
    expect(deviceKind([soilMoisture, battery])).toBe('soil');
    expect(deviceKind([soilMoisture, temperature])).toBe('soil');
  });

  it('recognises climate without soil moisture', () => {
    expect(deviceKind([temperature])).toBe('climate');
    expect(deviceKind([humidity, battery])).toBe('climate');
  });

  it('recognises a contact sensor', () => {
    expect(deviceKind([contact, battery])).toBe('contact');
  });

  it('falls back to other', () => {
    expect(deviceKind([])).toBe('other');
    expect(deviceKind([battery])).toBe('other');
  });
});
