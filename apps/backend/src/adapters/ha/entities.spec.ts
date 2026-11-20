import { readFileSync } from 'node:fs';
import { capabilitiesOf } from './entities.js';
import { haDeviceSchema } from './protocol.js';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../../integrations/home-assistant/fixtures/${name}.json`, import.meta.url),
      'utf8',
    ),
  );
const fixtureDevices = (fixture('devices') as { devices: unknown[] }).devices;

const deviceOf = (raw: unknown) => haDeviceSchema.parse(raw);
const device = (entities: Record<string, unknown>[]) =>
  deviceOf({ id: 'd1', entities: entities.map((e) => ({ domain: 'sensor', ...e })) });
const sensor = (entity_id: string, device_class: string, unit: string | null) => ({
  entity_id,
  domain: 'sensor',
  device_class,
  unit,
});
const lamp = (capabilities: unknown) =>
  device([{ entity_id: 'light.l', domain: 'light', capabilities }]);

describe('capabilitiesOf', () => {
  it('turns the lamp of the fixture into state, brightness and color_temp', () => {
    const caps = capabilitiesOf(deviceOf(fixtureDevices[0]));
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
        native: { entity: 'light.stehlampe', source: 'onoff' },
      },
      {
        key: 'brightness',
        kind: 'numeric',
        unit: '%',
        min: 0,
        max: 100,
        step: 1,
        enumValues: null,
        readable: true,
        writable: true,
        isSetting: false,
        native: { entity: 'light.stehlampe', source: 'brightness' },
      },
      {
        key: 'color_temp',
        kind: 'numeric',
        unit: 'K',
        min: 1700,
        max: 6500,
        step: null,
        enumValues: null,
        readable: true,
        writable: true,
        isSetting: false,
        native: { entity: 'light.stehlampe', source: 'kelvin' },
      },
    ]);
  });

  it('turns the plant sensors into readings, sorted by entity_id, and ignores illuminance', () => {
    const caps = capabilitiesOf(deviceOf(fixtureDevices[1]));
    expect(caps.map((c) => c.key)).toEqual([
      'battery',
      'soil_moisture',
      'temperature',
      'temperature_2',
    ]);
    expect(caps[0]).toMatchObject({
      kind: 'numeric',
      unit: '%',
      min: 0,
      max: 100,
      readable: true,
      writable: false,
      isSetting: false,
      native: { entity: 'sensor.monstera_battery', source: 'numeric', unit: '%' },
    });
    expect(caps[2]).toMatchObject({
      unit: '°C',
      native: { entity: 'sensor.monstera_temperature', source: 'numeric', unit: '°F' },
    });
    expect(caps[3]?.native).toEqual({
      entity: 'sensor.monstera_temperature_2',
      source: 'numeric',
      unit: '°C',
    });
  });

  it('turns a door sensor into contact and a switch into state', () => {
    const caps = capabilitiesOf(deviceOf(fixtureDevices[2]));
    expect(caps.map((c) => c.key)).toEqual(['contact', 'state']);
    expect(caps[0]).toMatchObject({
      kind: 'binary',
      writable: false,
      native: { entity: 'binary_sensor.flur_tuer', source: 'closed' },
    });
    expect(caps[1]).toMatchObject({ writable: true, native: { source: 'onoff' } });
  });

  it('sorts by entity_id whatever the order of the list', () => {
    const caps = capabilitiesOf(
      device([sensor('sensor.b', 'humidity', '%'), sensor('sensor.a', 'battery', '%')]),
    );
    expect(caps.map((c) => c.key)).toEqual(['battery', 'humidity']);
  });

  it('gives a lamp that only switches just a state', () => {
    expect(capabilitiesOf(lamp({ supported_color_modes: ['onoff'] })).map((c) => c.key)).toEqual([
      'state',
    ]);
    expect(capabilitiesOf(lamp(null)).map((c) => c.key)).toEqual(['state']);
  });

  it('gives a dimmable lamp a brightness', () => {
    expect(
      capabilitiesOf(lamp({ supported_color_modes: ['brightness'] })).map((c) => c.key),
    ).toEqual(['state', 'brightness']);
  });

  it('keeps the colour temperature inside the vocabulary', () => {
    const caps = capabilitiesOf(
      lamp({
        supported_color_modes: ['color_temp'],
        min_color_temp_kelvin: 500,
        max_color_temp_kelvin: 20000,
      }),
    );
    expect(caps.find((c) => c.key === 'color_temp')).toMatchObject({ min: 1000, max: 10000 });
    const open = capabilitiesOf(lamp({ supported_color_modes: ['color_temp'] }));
    expect(open.find((c) => c.key === 'color_temp')).toMatchObject({ min: 1000, max: 10000 });
  });

  it('accepts temperature in °C, °F and K only', () => {
    for (const unit of ['°C', '°F', 'K']) {
      expect(capabilitiesOf(device([sensor('sensor.t', 'temperature', unit)]))).toHaveLength(1);
    }
    expect(capabilitiesOf(device([sensor('sensor.t', 'temperature', '°X')]))).toEqual([]);
    expect(capabilitiesOf(device([sensor('sensor.t', 'temperature', null)]))).toEqual([]);
  });

  it('wants % for humidity, moisture and battery', () => {
    for (const cls of ['humidity', 'moisture', 'battery']) {
      expect(capabilitiesOf(device([sensor('sensor.x', cls, null)]))).toEqual([]);
      expect(capabilitiesOf(device([sensor('sensor.x', cls, 'lx')]))).toEqual([]);
    }
  });

  it('numbers keys that are taken', () => {
    const caps = capabilitiesOf(
      device([
        sensor('sensor.t1', 'temperature', '°C'),
        sensor('sensor.t2', 'temperature', '°C'),
        sensor('sensor.t3', 'temperature', '°C'),
      ]),
    );
    expect(caps.map((c) => c.key)).toEqual(['temperature', 'temperature_2', 'temperature_3']);
  });

  it('gives a second switch a numbered state', () => {
    const caps = capabilitiesOf(
      device([
        { entity_id: 'switch.a', domain: 'switch' },
        { entity_id: 'switch.b', domain: 'switch' },
      ]),
    );
    expect(caps.map((c) => c.key)).toEqual(['state', 'state_2']);
  });

  it('maps door-like binary sensors only', () => {
    const binary = (device_class: string | null) =>
      capabilitiesOf(
        device([{ entity_id: 'binary_sensor.x', domain: 'binary_sensor', device_class }]),
      );
    for (const cls of ['door', 'window', 'opening', 'garage_door']) {
      expect(binary(cls).map((c) => c.key)).toEqual(['contact']);
    }
    expect(binary('motion')).toEqual([]);
    expect(binary(null)).toEqual([]);
  });

  it('drops an entity of another domain', () => {
    expect(
      capabilitiesOf(device([{ entity_id: 'fan.x', domain: 'fan', device_class: null }])),
    ).toEqual([]);
  });
});
