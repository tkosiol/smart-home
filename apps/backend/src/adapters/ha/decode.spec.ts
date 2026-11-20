import { readFileSync } from 'node:fs';
import type { StoredCapability } from '../../core/adapters/index.js';
import { capabilitiesOf } from './entities.js';
import { availabilityOf, decodeHaReport } from './decode.js';
import { haDeviceSchema } from './protocol.js';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../../integrations/home-assistant/fixtures/${name}.json`, import.meta.url),
      'utf8',
    ),
  );
const devices = (fixture('devices') as { devices: unknown[] }).devices;
const capsOf = (index: number) => capabilitiesOf(haDeviceSchema.parse(devices[index]));
const lampCaps = capsOf(0);

const numeric = (entity: string, unit?: string, key = 'temperature'): StoredCapability[] => [
  {
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
    native: { entity, source: 'numeric', ...(unit ? { unit } : {}) },
  },
];
const lampSnapshot = (
  attributes: Record<string, unknown>,
  state = 'on',
  last_updated?: string,
) => ({
  v: 1,
  entities: { 'light.stehlampe': { state, attributes, last_updated } },
});

describe('decodeHaReport', () => {
  it('decodes a lamp that is on', () => {
    expect(decodeHaReport(fixture('device-lamp-on'), lampCaps)).toEqual({
      values: { state: true, brightness: 50, color_temp: 2700 },
      measuredAt: new Date('2026-11-19T18:03:21.123Z'),
    });
  });

  it('decodes a lamp that is off to just its state', () => {
    expect(decodeHaReport(fixture('device-lamp-off'), lampCaps).values).toEqual({ state: false });
  });

  it('decodes an unavailable lamp to nothing', () => {
    expect(decodeHaReport(fixture('device-lamp-unavailable'), lampCaps).values).toEqual({});
    expect(decodeHaReport(lampSnapshot({}, 'unknown'), lampCaps).values).toEqual({});
  });

  it('rounds brightness but never turns a lit lamp into 0', () => {
    const brightness = (raw: number) =>
      decodeHaReport(lampSnapshot({ brightness: raw }), lampCaps).values.brightness;
    expect(brightness(1)).toBe(1);
    expect(brightness(255)).toBe(100);
    expect(brightness(0)).toBe(0);
    expect(brightness(128)).toBe(50);
  });

  it('keeps the colour temperature inside the vocabulary', () => {
    const kelvin = (raw: unknown) =>
      decodeHaReport(lampSnapshot({ color_temp_kelvin: raw }), lampCaps).values.color_temp;
    expect(kelvin(12000)).toBe(10000);
    expect(kelvin(500)).toBe(1000);
    expect(kelvin(2700.4)).toBe(2700);
    expect(kelvin(null)).toBeUndefined();
    expect(kelvin('warm')).toBeUndefined();
  });

  it('decodes the plant, converting °F, and takes the latest update as the time', () => {
    expect(decodeHaReport(fixture('device-plant'), capsOf(1))).toEqual({
      values: { battery: 87, soil_moisture: 41.5, temperature: 20, temperature_2: 19.25 },
      measuredAt: new Date('2026-11-19T17:00:00Z'),
    });
  });

  it('decodes the door sensor: open is not closed, an outlet that is off is off', () => {
    expect(decodeHaReport(fixture('device-door'), capsOf(2)).values).toEqual({
      contact: false,
      state: false,
    });
    const closed = { v: 1, entities: { 'binary_sensor.flur_tuer': { state: 'off' } } };
    expect(decodeHaReport(closed, capsOf(2)).values).toEqual({ contact: true });
  });

  it('converts Kelvin and rounds to two places', () => {
    const t = (state: string, unit: string) =>
      decodeHaReport({ v: 1, entities: { 'sensor.t': { state } } }, numeric('sensor.t', unit))
        .values.temperature;
    expect(t('293.15', 'K')).toBe(20);
    expect(t('70.1', '°F')).toBe(21.17);
    expect(t('21.5', '°C')).toBe(21.5);
  });

  it('reads the unit the state is shown in, which a user may change in HA after the listing', () => {
    const t = (state: string, attributes: Record<string, unknown> | undefined, unit = '°C') =>
      decodeHaReport(
        { v: 1, entities: { 'sensor.t': { state, attributes } } },
        numeric('sensor.t', unit),
      ).values.temperature;
    // Listed in °C, shown in °F since: the state is °F.
    expect(t('70.1', { unit_of_measurement: '°F' })).toBe(21.17);
    expect(t('293.15', { unit_of_measurement: 'K' }, '°F')).toBe(20);
    expect(t('21.5', { unit_of_measurement: '°C' }, '°F')).toBe(21.5);
    // A unit that does not fit the capability is no reading rather than a wrong one.
    expect(t('21.5', { unit_of_measurement: 'lx' })).toBeUndefined();
    expect(t('21.5', { unit_of_measurement: '%' })).toBeUndefined();
    const humidity = (attributes: Record<string, unknown>) =>
      decodeHaReport(
        { v: 1, entities: { 'sensor.h': { state: '55', attributes } } },
        numeric('sensor.h', '%', 'humidity'),
      ).values.humidity;
    expect(humidity({ unit_of_measurement: '%' })).toBe(55);
    expect(humidity({ unit_of_measurement: '°C' })).toBeUndefined();
    // Without the attribute (or with one that is no text) the unit of the listing applies.
    expect(t('70.1', undefined, '°F')).toBe(21.17);
    expect(t('70.1', {}, '°F')).toBe(21.17);
    expect(t('70.1', { unit_of_measurement: null }, '°F')).toBe(21.17);
  });

  it('gives no value for a state that is no number', () => {
    const decode = (state: string) =>
      decodeHaReport({ v: 1, entities: { 'sensor.t': { state } } }, numeric('sensor.t', '°C'))
        .values;
    expect(decode('abc')).toEqual({});
    expect(decode('')).toEqual({});
    expect(decode('unavailable')).toEqual({});
    expect(decode('NaN')).toEqual({});
  });

  it('does not trust a last_updated without a zone', () => {
    const snapshot = lampSnapshot({}, 'on', '2026-11-19T18:03:21');
    expect(decodeHaReport(snapshot, lampCaps).measuredAt).toBeUndefined();
    const offset = lampSnapshot({}, 'on', '2026-11-19T19:03:21+01:00');
    expect(decodeHaReport(offset, lampCaps).measuredAt).toEqual(new Date('2026-11-19T18:03:21Z'));
  });

  it('skips a missing entity, a broken stored row and a broken snapshot', () => {
    expect(decodeHaReport({ v: 1, entities: {} }, lampCaps)).toEqual({
      values: {},
      measuredAt: undefined,
    });
    const broken = [{ ...lampCaps[0], native: null } as unknown as StoredCapability];
    expect(decodeHaReport(fixture('device-lamp-on'), broken).values).toEqual({});
    for (const native of [null, 'x', [], { v: 1 }, { v: 1, entities: 'x' }]) {
      expect(decodeHaReport(native, lampCaps).values).toEqual({});
    }
  });
});

describe('availabilityOf', () => {
  it('is offline when every entity is unavailable', () => {
    expect(availabilityOf(fixture('device-lamp-unavailable'))).toBe('offline');
  });
  it('is online when any entity answers', () => {
    expect(availabilityOf(fixture('device-lamp-on'))).toBe('online');
    expect(availabilityOf(fixture('device-plant'))).toBe('online');
    const mixed = {
      v: 1,
      entities: { 'sensor.a': { state: 'unavailable' }, 'sensor.b': { state: '1' } },
    };
    expect(availabilityOf(mixed)).toBe('online');
  });
  it('says nothing for a snapshot without entities', () => {
    expect(availabilityOf({ v: 1, entities: {} })).toBeUndefined();
    expect(availabilityOf(null)).toBeUndefined();
  });
});
