import { readFileSync } from 'node:fs';
import type { Capability } from '@smart/contracts';
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

const capabilitiesOf = (name: string): Capability[] => {
  const device = fixture.find((entry) => entry.friendly_name === name);
  return capabilitiesFromExposes(exposesSchema.parse(device?.definition?.exposes));
};
const byKey = (list: Capability[], key: string): Capability | undefined =>
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
      });
      expect(byKey(list, 'soil_moisture')).toMatchObject({ kind: 'numeric', unit: '%', min: null });
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

    it('flattens the features of the light', () => {
      expect(byKey(list, 'state')?.kind).toBe('binary');
      expect(byKey(list, 'brightness')).toMatchObject({ kind: 'numeric', min: 0, max: 254 });
      expect(byKey(list, 'color_temp')).toMatchObject({ unit: 'mired', min: 153, max: 500 });
    });

    it('treats state, brightness and color_temp as readings although they are settable', () => {
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

  it('rejects entries that are no objects', () => {
    expect(exposesSchema.safeParse(['x']).success).toBe(false);
  });
});
