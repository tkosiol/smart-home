import type { Capability, Device } from '@smart/contracts';
import { batteryPercent, formatReading, isReading, readingsOf } from './device-values';

const NBSP = String.fromCharCode(0xa0);
const capability = (overrides: Partial<Capability> & { key: string }): Capability => ({
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
const moisture = capability({ key: 'soil_moisture', unit: '%' });

describe('formatReading', () => {
  it('formats numbers with the language of the locale and the unit', () => {
    expect(formatReading(moisture, 41.26, 'de')).toEqual({ kind: 'text', text: `41,3${NBSP}%` });
    expect(formatReading(moisture, 41.26, 'en')).toEqual({ kind: 'text', text: `41.3${NBSP}%` });
    expect(formatReading(capability({ key: 'linkquality' }), 87, 'de')).toEqual({
      kind: 'text',
      text: '87',
    });
  });

  it('marks a missing or unusable value as missing', () => {
    expect(formatReading(moisture, undefined, 'de')).toEqual({ kind: 'missing' });
    expect(formatReading(moisture, null, 'de')).toEqual({ kind: 'missing' });
    expect(formatReading(moisture, 'wet', 'de')).toEqual({ kind: 'missing' });
    expect(formatReading(moisture, Number.NaN, 'de')).toEqual({ kind: 'missing' });
    expect(formatReading(capability({ key: 'color', kind: 'composite' }), { x: 1 }, 'de')).toEqual({
      kind: 'missing',
    });
  });

  it('reads binary values given as booleans or ON/OFF', () => {
    const binary = capability({ key: 'contact', kind: 'binary' });
    expect(formatReading(binary, true, 'de')).toEqual({ kind: 'binary', on: true, style: 'yesNo' });
    expect(formatReading(binary, 'OFF', 'de')).toEqual({
      kind: 'binary',
      on: false,
      style: 'yesNo',
    });
    expect(formatReading(binary, 'maybe', 'de')).toEqual({ kind: 'missing' });
  });

  it('gives the dry warning and the switch state their own words', () => {
    expect(formatReading(capability({ key: 'dry', kind: 'binary' }), true, 'de')).toEqual({
      kind: 'binary',
      on: true,
      style: 'dry',
    });
    expect(formatReading(capability({ key: 'state', kind: 'binary' }), 'ON', 'de')).toEqual({
      kind: 'binary',
      on: true,
      style: 'power',
    });
  });

  it('shows enum and text values as they are', () => {
    const mode = capability({ key: 'mode', kind: 'enum', enumValues: ['eco', 'boost'] });
    expect(formatReading(mode, 'eco', 'de')).toEqual({ kind: 'text', text: 'eco' });
    expect(formatReading(capability({ key: 'note', kind: 'text' }), 'hi', 'de')).toEqual({
      kind: 'text',
      text: 'hi',
    });
  });
});

describe('readings', () => {
  it('keeps readable measurements and leaves settings, write-only and composite values out', () => {
    const all = [
      moisture,
      capability({ key: 'soil_calibration', isSetting: true }),
      capability({ key: 'identify', kind: 'enum', readable: false, writable: true }),
      capability({ key: 'color', kind: 'composite' }),
    ];
    expect(all.filter(isReading).map((c) => c.key)).toEqual(['soil_moisture']);
    const device = { capabilities: all } as Device;
    expect(readingsOf(device).map((c) => c.key)).toEqual(['soil_moisture']);
  });

  it('reads the battery percentage from the state', () => {
    const device = (state: Record<string, unknown>) => ({ state }) as Device;
    expect(batteryPercent(device({ battery: 15 }))).toBe(15);
    expect(batteryPercent(device({ battery: 'low' }))).toBeUndefined();
    expect(batteryPercent(device({}))).toBeUndefined();
  });
});
