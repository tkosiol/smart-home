import { readFileSync } from 'node:fs';
import { translateDevices } from './devices.js';

const fixtureBuffer = (name: string): Buffer =>
  readFileSync(
    new URL(`../../../../../integrations/home-assistant/fixtures/${name}.json`, import.meta.url),
  );
const buffer = (value: unknown) => Buffer.from(JSON.stringify(value));
const hardwareOf = (events: ReturnType<typeof translateDevices>) => {
  const [event] = events;
  if (event?.type !== 'hardware.listed') throw new Error('no list');
  return event.hardware;
};

describe('translateDevices', () => {
  const fixture = JSON.parse(fixtureBuffer('devices').toString('utf8')) as {
    devices: Record<string, unknown>[];
  };

  it('lists the devices of the fixture as hardware', () => {
    const events = translateDevices(fixtureBuffer('devices'));
    expect(events).toHaveLength(1);
    const hardware = hardwareOf(events);
    expect(hardware).toHaveLength(3);
    expect(hardware[0]).toMatchObject({
      externalId: '0a1b2c3d4e5f60718293a4b5c6d7e8f9',
      address: '0a1b2c3d4e5f60718293a4b5c6d7e8f9',
      name: 'Stehlampe',
      vendor: 'Yeelight',
      model: 'color4',
      description: null,
      setupState: 'ready',
      native: fixture.devices[0],
    });
    expect(hardware[0]?.capabilities.map((c) => c.key)).toEqual([
      'state',
      'brightness',
      'color_temp',
    ]);
    expect(hardware[1]?.capabilities.map((c) => c.key)).toEqual([
      'battery',
      'soil_moisture',
      'temperature',
      'temperature_2',
    ]);
  });

  it('names a device without a name after its first entity, with an empty vendor', () => {
    const door = hardwareOf(translateDevices(fixtureBuffer('devices')))[2];
    expect(door).toMatchObject({ name: 'Flurtür', vendor: '', model: 'Door sensor' });
    expect(door?.capabilities.map((c) => c.key)).toEqual(['contact', 'state']);
  });

  it('falls back to the model and then to the id for a name', () => {
    const [bare, modelOnly] = hardwareOf(
      translateDevices(
        buffer({
          v: 1,
          devices: [
            { id: 'aa', entities: [] },
            { id: 'bb', model: 'M1', entities: [] },
          ],
        }),
      ),
    );
    expect(bare).toMatchObject({ name: 'aa', vendor: '', model: '' });
    expect(modelOnly).toMatchObject({ name: 'M1' });
  });

  it('reports nothing for another version or no list', () => {
    expect(translateDevices(buffer({ v: 2, devices: [] }))).toEqual([]);
    expect(translateDevices(buffer({ v: 1 }))).toEqual([]);
    expect(translateDevices(buffer({ v: 1, devices: 'x' }))).toEqual([]);
    expect(translateDevices(Buffer.from('nope'))).toEqual([]);
    expect(translateDevices(buffer([]))).toEqual([]);
  });

  it('leaves out a device without an id and keeps the others', () => {
    const hardware = hardwareOf(
      translateDevices(
        buffer({ v: 1, devices: [{ name: 'x', entities: [] }, 42, fixture.devices[0]] }),
      ),
    );
    expect(hardware.map((h) => h.name)).toEqual(['Stehlampe']);
  });

  it('leaves out a broken entity and keeps the others of the device', () => {
    const device = {
      id: 'aa',
      entities: [
        { entity_id: 'sensor.ok', domain: 'sensor', device_class: 'battery', unit: '%' },
        { domain: 'sensor' },
        'junk',
      ],
    };
    const [hardware] = hardwareOf(translateDevices(buffer({ v: 1, devices: [device] })));
    expect(hardware?.capabilities.map((c) => c.key)).toEqual(['battery']);
  });

  it('does not take a list of nothing but garbage for an empty one', () => {
    expect(translateDevices(buffer({ v: 1, devices: [1, 'x', {}] }))).toEqual([]);
    expect(translateDevices(buffer({ v: 1, devices: [] }))).toEqual([
      { type: 'hardware.listed', hardware: [] },
    ]);
  });
});
