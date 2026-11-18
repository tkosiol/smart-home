import type { Capability } from '@smart/contracts';
import type { StoredCapability } from '../../core/adapters/index.js';
import { decodeZ2mReport } from './decode.js';

const cap = (
  key: string,
  kind: Capability['kind'],
  native: Record<string, unknown>,
): StoredCapability => ({
  key,
  kind,
  unit: null,
  min: null,
  max: null,
  step: null,
  enumValues: null,
  readable: true,
  writable: false,
  isSetting: false,
  native,
});

describe('decodeZ2mReport', () => {
  it('turns on/off into booleans with the stored values', () => {
    const light = [cap('state', 'binary', { property: 'state', valueOn: 'ON', valueOff: 'OFF' })];
    expect(decodeZ2mReport({ state: 'ON' }, light).values).toEqual({ state: true });
    expect(decodeZ2mReport({ state: 'OFF' }, light).values).toEqual({ state: false });
    expect(decodeZ2mReport({ state: true }, light).values).toEqual({ state: true });
    expect(decodeZ2mReport({ state: 'TOGGLE' }, light).values).toEqual({ state: 'TOGGLE' });
    const lock = [
      cap('state_z2m', 'binary', { property: 'state', valueOn: 'LOCK', valueOff: 'UNLOCK' }),
    ];
    expect(decodeZ2mReport({ state: 'LOCK' }, lock).values).toEqual({ state_z2m: true });
  });

  it('takes a boolean as it is, whatever the stored values say', () => {
    // Z2M's contact preset says value_on=false, but both Z2M and the vocabulary mean true = closed.
    const contact = [
      cap('contact', 'binary', { property: 'contact', valueOn: false, valueOff: true }),
    ];
    expect(decodeZ2mReport({ contact: false }, contact).values).toEqual({ contact: false });
    expect(decodeZ2mReport({ contact: true }, contact).values).toEqual({ contact: true });
  });

  it('falls back to ON/OFF for rows stored before the native values', () => {
    expect(
      decodeZ2mReport({ state: 'OFF' }, [cap('state', 'binary', { property: 'state' })]).values,
    ).toEqual({ state: false });
  });

  it('converts brightness and colour temperature', () => {
    const caps = [
      cap('brightness', 'numeric', { property: 'brightness', max: 254 }),
      cap('color_temp', 'numeric', { property: 'color_temp' }),
    ];
    expect(decodeZ2mReport({ brightness: 254, color_temp: 370 }, caps).values).toEqual({
      brightness: 100,
      color_temp: 2703,
    });
    expect(decodeZ2mReport({ brightness: 127, color_temp: 0 }, caps).values).toEqual({
      brightness: 50,
    });
    expect(decodeZ2mReport({ brightness: 'x' }, caps).values).toEqual({ brightness: 'x' });
  });

  it('scales brightness by 254 when no usable maximum is stored', () => {
    const caps = [cap('brightness', 'numeric', { property: 'brightness', max: 0 })];
    expect(decodeZ2mReport({ brightness: 127 }, caps).values).toEqual({ brightness: 50 });
  });

  it('keeps passed-through values of the same Z2M name as they are', () => {
    const caps = [cap('brightness_z2m', 'numeric', { property: 'brightness' })];
    expect(decodeZ2mReport({ brightness: 800 }, caps).values).toEqual({ brightness_z2m: 800 });
  });

  it('keeps other fields as they are and ignores fields without a capability', () => {
    const caps = [cap('soil_moisture', 'numeric', { property: 'soil_moisture' })];
    expect(
      decodeZ2mReport(
        { soil_moisture: 41.5, last_seen: '2026-11-18T10:00:00+01:00', update: {} },
        caps,
      ).values,
    ).toEqual({ soil_moisture: 41.5 });
  });

  it('skips capabilities without a stored property and fields that are only inherited', () => {
    const caps = [cap('battery', 'numeric', {}), cap('toString', 'text', { property: 'toString' })];
    expect(decodeZ2mReport({ battery: 80 }, caps).values).toEqual({});
  });

  it('skips capabilities whose stored native fields are unusable, without throwing', () => {
    const broken = [
      { ...cap('battery', 'numeric', {}), native: undefined },
      { ...cap('humidity', 'numeric', {}), native: null },
      { ...cap('temperature', 'numeric', {}), native: 'temperature' },
      cap('linkquality', 'numeric', { property: 42 }),
      cap('soil_moisture', 'numeric', { property: 'soil_moisture' }),
    ] as unknown as StoredCapability[];
    expect(
      decodeZ2mReport(
        { battery: 80, humidity: 50, temperature: 20, linkquality: 9, 42: 1, soil_moisture: 30 },
        broken,
      ).values,
    ).toEqual({ soil_moisture: 30 });
  });

  it('reads last_seen only with a zone', () => {
    expect(
      decodeZ2mReport({ last_seen: '2026-11-18T10:00:00+01:00' }, []).measuredAt?.toISOString(),
    ).toBe('2026-11-18T09:00:00.000Z');
    expect(decodeZ2mReport({ last_seen: '2026-11-18T10:00:00' }, []).measuredAt).toBeUndefined();
    expect(decodeZ2mReport({ last_seen: 1_700_000_000_000 }, []).measuredAt).toBeUndefined();
    expect(decodeZ2mReport({ last_seen: 'not a dateZ' }, []).measuredAt).toBeUndefined();
    expect(decodeZ2mReport('not an object', []).values).toEqual({});
    expect(decodeZ2mReport([1, 2], []).values).toEqual({});
  });
});
