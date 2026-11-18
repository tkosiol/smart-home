import { readFileSync } from 'node:fs';
import type { ReportedCapability } from '../../core/adapters/index.js';
import { capabilitiesFromExposes, exposesSchema } from './exposes.js';

interface FixtureDevice {
  friendly_name: string;
  definition?: { exposes: unknown };
}

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../../gateway-simulator/fixtures/devices.json', import.meta.url),
    'utf8',
  ),
) as FixtureDevice[];

const capabilitiesOf = (name: string): ReportedCapability[] => {
  const device = fixture.find((entry) => entry.friendly_name === name);
  return capabilitiesFromExposes(exposesSchema.parse(device?.definition?.exposes));
};
const byKey = (list: ReportedCapability[], key: string): ReportedCapability | undefined =>
  list.find((capability) => capability.key === key);

describe('capabilitiesFromExposes', () => {
  describe('soil moisture sensor (AY-303Z)', () => {
    const list = capabilitiesOf('Pflanze 1');

    it.each(['soil_moisture', 'battery', 'dry', 'temperature', 'humidity', 'linkquality'])(
      'treats %s as a reading',
      (key) => {
        const capability = byKey(list, key);
        expect(capability).toMatchObject({ readable: true, writable: false, isSetting: false });
      },
    );

    it.each([
      'temperature_calibration',
      'humidity_calibration',
      'soil_calibration',
      'temperature_sampling',
      'soil_sampling',
      'soil_warning',
      'temperature_unit',
    ])('treats %s as a setting', (key) => {
      expect(byKey(list, key)).toMatchObject({ readable: true, writable: true, isSetting: true });
    });

    it('carries unit, range and step of a numeric capability', () => {
      expect(byKey(list, 'soil_warning')).toEqual({
        key: 'soil_warning',
        kind: 'numeric',
        unit: '%',
        min: 0,
        max: 100,
        step: 1,
        enumValues: null,
        readable: true,
        writable: true,
        isSetting: true,
        native: { property: 'soil_warning' },
      });
      expect(byKey(list, 'soil_moisture')).toMatchObject({
        kind: 'numeric',
        unit: '%',
        min: 0,
        max: 100,
      });
    });

    it('keeps the values of an enum and the kind of a binary', () => {
      expect(byKey(list, 'temperature_unit')).toMatchObject({
        kind: 'enum',
        enumValues: ['celsius', 'fahrenheit'],
      });
      expect(byKey(list, 'dry')?.kind).toBe('binary');
    });

    it('lists a write-only capability as not readable and not a setting', () => {
      expect(byKey(list, 'identify')).toMatchObject({
        readable: false,
        writable: true,
        isSetting: false,
      });
    });
  });

  describe('lamp (LED1624G9)', () => {
    const list = capabilitiesOf('Lampe');

    it('flattens the features of the light onto the vocabulary', () => {
      expect(byKey(list, 'state')).toMatchObject({
        kind: 'binary',
        native: { property: 'state', valueOn: 'ON', valueOff: 'OFF' },
      });
      expect(byKey(list, 'brightness')).toMatchObject({
        kind: 'numeric',
        unit: '%',
        min: 0,
        max: 100,
        native: { property: 'brightness', max: 254 },
      });
      expect(byKey(list, 'color_temp')).toMatchObject({ unit: 'K', min: 2000, max: 6536 });
    });

    it('treats state, brightness and color_temp as controls, not settings', () => {
      for (const key of ['state', 'brightness', 'color_temp']) {
        expect(byKey(list, key)).toMatchObject({
          readable: true,
          writable: true,
          isSetting: false,
        });
      }
    });

    it('treats the power-on behaviour as a setting and the effect as write-only', () => {
      expect(byKey(list, 'power_on_behavior')).toMatchObject({ kind: 'enum', isSetting: true });
      expect(byKey(list, 'effect')).toMatchObject({
        readable: false,
        writable: true,
        isSetting: false,
      });
    });

    it('keeps a composite as one capability instead of its members', () => {
      expect(byKey(list, 'color')?.kind).toBe('composite');
      expect(byKey(list, 'x')).toBeUndefined();
    });

    it('has every key once', () => {
      const keys = list.map((capability) => capability.key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  it('maps a light onto the vocabulary', () => {
    const caps = capabilitiesFromExposes([
      {
        type: 'light',
        features: [
          { type: 'binary', property: 'state', access: 7, value_on: 'ON', value_off: 'OFF' },
          { type: 'numeric', property: 'brightness', access: 7, value_min: 0, value_max: 254 },
          {
            type: 'numeric',
            property: 'color_temp',
            access: 7,
            value_min: 250,
            value_max: 454,
            unit: 'mired',
          },
        ],
      },
    ]);
    expect(caps).toEqual([
      {
        key: 'state',
        kind: 'binary',
        unit: null,
        min: null,
        max: null,
        step: null,
        enumValues: null,
        readable: true,
        writable: true,
        isSetting: false,
        native: { property: 'state', valueOn: 'ON', valueOff: 'OFF' },
      },
      {
        key: 'brightness',
        kind: 'numeric',
        unit: '%',
        min: 0,
        max: 100,
        step: null,
        enumValues: null,
        readable: true,
        writable: true,
        isSetting: false,
        native: { property: 'brightness', max: 254 },
      },
      {
        key: 'color_temp',
        kind: 'numeric',
        unit: 'K',
        min: 2203,
        max: 4000,
        step: null,
        enumValues: null,
        readable: true,
        writable: true,
        isSetting: false,
        native: { property: 'color_temp' },
      },
    ]);
  });

  it('takes the range of a colour temperature from the vocabulary when the light has none', () => {
    const caps = capabilitiesFromExposes([
      {
        type: 'switch',
        features: [
          { type: 'numeric', property: 'brightness', access: 7 },
          { type: 'numeric', property: 'color_temp', access: 7, value_min: 0 },
        ],
      },
    ]);
    expect(caps.map((c) => [c.key, c.min, c.max, c.native])).toEqual([
      ['brightness', 0, 100, { property: 'brightness', max: 254 }],
      ['color_temp', 1000, 10000, { property: 'color_temp' }],
    ]);
  });

  it('narrows the range of a colour temperature only within the vocabulary', () => {
    const [colorTemp] = capabilitiesFromExposes([
      {
        type: 'light',
        features: [
          { type: 'numeric', property: 'color_temp', access: 7, value_min: 50, value_max: 2000 },
        ],
      },
    ]);
    expect(colorTemp).toMatchObject({ key: 'color_temp', min: 1000, max: 10000 });
    const [tooCold] = capabilitiesFromExposes([
      {
        type: 'light',
        features: [
          { type: 'numeric', property: 'color_temp', access: 7, value_min: 20, value_max: 50 },
        ],
      },
    ]);
    expect(tooCold).toMatchObject({ min: 10000, max: 10000 });
  });

  it('keeps a lock state apart from a light', () => {
    const [lock] = capabilitiesFromExposes([
      {
        type: 'lock',
        features: [
          { type: 'binary', property: 'state', access: 7, value_on: 'LOCK', value_off: 'UNLOCK' },
        ],
      },
    ]);
    expect(lock).toMatchObject({
      key: 'state_z2m',
      kind: 'binary',
      native: { property: 'state', valueOn: 'LOCK', valueOff: 'UNLOCK' },
    });
  });

  it('keeps a brightness that is no feature of a light or switch apart', () => {
    const [brightness] = capabilitiesFromExposes([
      { type: 'numeric', property: 'brightness', access: 1, value_max: 1000 },
    ]);
    expect(brightness).toMatchObject({
      key: 'brightness_z2m',
      max: 1000,
      native: { property: 'brightness' },
    });
  });

  it('takes unit and range of canonical readings from the vocabulary', () => {
    const caps = capabilitiesFromExposes([
      {
        type: 'numeric',
        property: 'soil_moisture',
        access: 1,
        unit: '%',
        value_min: 0,
        value_max: 100,
      },
      { type: 'numeric', property: 'battery', access: 1, unit: '%' },
      {
        type: 'numeric',
        property: 'linkquality',
        access: 1,
        unit: 'lqi',
        value_min: 0,
        value_max: 255,
      },
      { type: 'binary', property: 'contact', access: 1, value_on: false, value_off: true },
    ]);
    expect(caps.map((c) => [c.key, c.unit, c.min, c.max])).toEqual([
      ['soil_moisture', '%', 0, 100],
      ['battery', '%', 0, 100],
      ['linkquality', 'lqi', 0, 255],
      ['contact', null, null, null],
    ]);
    expect(caps[3]?.native).toEqual({ property: 'contact', valueOn: false, valueOff: true });
  });

  it('passes unknown readings and settings through', () => {
    const caps = capabilitiesFromExposes([
      { type: 'binary', property: 'dry', access: 1, value_on: true, value_off: false },
      { type: 'numeric', property: 'soil_calibration', access: 7, unit: '%' },
    ]);
    expect(caps[0]).toMatchObject({
      key: 'dry',
      kind: 'binary',
      isSetting: false,
      native: { property: 'dry', valueOn: true, valueOff: false },
    });
    expect(caps[1]).toMatchObject({
      key: 'soil_calibration',
      unit: '%',
      isSetting: true,
      native: { property: 'soil_calibration' },
    });
  });

  it('suffixes a canonical name whose kind does not fit', () => {
    const [enumState] = capabilitiesFromExposes([
      { type: 'enum', property: 'temperature', access: 1, values: ['low', 'high'] },
    ]);
    expect(enumState).toMatchObject({ key: 'temperature_z2m', kind: 'enum' });
  });

  it('drops properties that are no valid key', () => {
    expect(
      capabilitiesFromExposes([{ type: 'numeric', property: 'Weird Name', access: 1 }]),
    ).toEqual([]);
  });

  it('keeps the first of two entries with the same key', () => {
    const list = capabilitiesFromExposes([
      { type: 'numeric', property: 'x', access: 1, unit: 'a' },
      { type: 'numeric', property: 'x', access: 3, unit: 'b' },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]?.unit).toBe('a');
  });

  it('skips an expose without a property', () => {
    expect(capabilitiesFromExposes([{ type: 'enum', access: 1 }])).toEqual([]);
  });

  it('maps unknown types to composite and a missing access to neither readable nor writable', () => {
    const [capability] = capabilitiesFromExposes([{ type: 'list', property: 'schedule' }]);
    expect(capability).toMatchObject({ kind: 'composite', readable: false, writable: false });
    expect(capabilitiesFromExposes([{ type: 'text', property: 't', access: 1 }])[0]?.kind).toBe(
      'text',
    );
  });

  it('stops at a nesting that is deeper than any real definition', () => {
    let deep = { type: 'numeric', property: 'deep', access: 1 } as Record<string, unknown>;
    for (let level = 0; level < 50; level += 1) deep = { type: 'light', features: [deep] };
    expect(capabilitiesFromExposes(exposesSchema.parse([deep]))).toEqual([]);
  });
});

describe('exposesSchema', () => {
  it('ignores fields of the wrong type instead of rejecting the definition', () => {
    const parsed = exposesSchema.parse([
      { type: 'numeric', property: 'p', access: 'x', unit: 5, value_min: 'a', values: [1, 'b'] },
    ]);
    expect(capabilitiesFromExposes(parsed)[0]).toMatchObject({
      key: 'p',
      unit: null,
      min: null,
      readable: false,
    });
  });

  it('keeps the on and off values of a binary as they are', () => {
    const [parsed] = exposesSchema.parse([
      { type: 'binary', property: 'p', value_on: 1, value_off: { x: 0 } },
    ]);
    expect(parsed).toMatchObject({ value_on: 1, value_off: { x: 0 } });
  });

  it('drops a malformed feature and keeps the ones next to it', () => {
    const parsed = exposesSchema.parse([
      {
        type: 'light',
        features: [
          { type: 'binary', property: 'state', access: 7 },
          'broken',
          { property: 'no-type' },
          { type: 'numeric', property: 'brightness', access: 7 },
        ],
      },
    ]);
    expect(capabilitiesFromExposes(parsed).map((capability) => capability.key)).toEqual([
      'state',
      'brightness',
    ]);
  });

  it('rejects entries that are no objects', () => {
    expect(exposesSchema.safeParse(['x']).success).toBe(false);
  });
});
