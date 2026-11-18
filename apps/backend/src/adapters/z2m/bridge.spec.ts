import { readFileSync } from 'node:fs';
import type { AdapterEvent, ReportedHardware } from '../../core/adapters/index.js';
import { translateDevices, translateEvent } from './bridge.js';

const fixture = readFileSync(
  new URL('../../../../gateway-simulator/fixtures/devices.json', import.meta.url),
  'utf8',
);
const fixtureDevices = JSON.parse(fixture) as Record<string, unknown>[];

const json = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));

/** The hardware of the one `hardware.listed` event, or fails. */
const listed = (events: AdapterEvent[]): ReportedHardware[] => {
  expect(events).toHaveLength(1);
  const [event] = events;
  if (event?.type !== 'hardware.listed') throw new Error(`no list: ${JSON.stringify(event)}`);
  return event.hardware;
};

describe('translateDevices', () => {
  it('lists the devices without the coordinator, with their capabilities', () => {
    expect(
      translateDevices(
        json([
          { ieee_address: '0x00124b0000000001', friendly_name: 'Coordinator', type: 'Coordinator' },
          {
            ieee_address: '0x00124b0000000002',
            friendly_name: 'Monstera',
            type: 'EndDevice',
            interview_state: 'SUCCESSFUL',
            definition: {
              vendor: 'TuYa',
              model: 'AY-303Z',
              description: 'Soil sensor',
              exposes: [{ type: 'numeric', property: 'soil_moisture', access: 1, unit: '%' }],
            },
          },
        ]),
      ),
    ).toEqual([
      {
        type: 'hardware.listed',
        hardware: [
          {
            externalId: '0x00124b0000000002',
            address: 'Monstera',
            name: 'Monstera',
            vendor: 'TuYa',
            model: 'AY-303Z',
            description: 'Soil sensor',
            setupState: 'ready',
            native: {
              vendor: 'TuYa',
              model: 'AY-303Z',
              description: 'Soil sensor',
              exposes: [{ type: 'numeric', property: 'soil_moisture', access: 1, unit: '%' }],
            },
            capabilities: [
              {
                key: 'soil_moisture',
                kind: 'numeric',
                unit: '%',
                min: 0,
                max: 100,
                step: null,
                enumValues: null,
                readable: true,
                writable: false,
                isSetting: false,
                native: { property: 'soil_moisture' },
              },
            ],
          },
        ],
      },
    ]);
  });

  it('lists the simulator fixture', () => {
    const hardware = listed(translateDevices(Buffer.from(fixture)));
    expect(hardware).toHaveLength(7);
    const lamp = hardware.find((entry) => entry.name === 'Lampe');
    expect(lamp).toMatchObject({
      externalId: '0x00000000000000a7',
      address: 'Lampe',
      vendor: 'IKEA',
      model: 'LED1624G9',
      setupState: 'ready',
      native: { model: 'LED1624G9' },
    });
    expect(lamp?.capabilities.map((capability) => capability.key)).toContain('brightness');
    const plant = hardware.find((entry) => entry.name === 'Pflanze 1');
    expect(
      plant?.capabilities.find((capability) => capability.key === 'soil_warning')?.isSetting,
    ).toBe(true);
  });

  it('keeps a device without a definition, with no capabilities', () => {
    expect(
      listed(
        translateDevices(
          json([
            {
              ieee_address: '0x00000000000000b1',
              friendly_name: 'mystery',
              type: 'EndDevice',
              interview_state: 'FAILED',
              definition: null,
              manufacturer: 'ACME',
              model_id: 'X-1',
            },
          ]),
        ),
      ),
    ).toEqual([
      {
        externalId: '0x00000000000000b1',
        address: 'mystery',
        name: 'mystery',
        vendor: 'ACME',
        model: 'X-1',
        description: null,
        setupState: 'failed',
        native: {},
        capabilities: [],
      },
    ]);
  });

  it.each([
    ['SUCCESSFUL', 'ready'],
    ['FAILED', 'failed'],
    ['PENDING', 'pairing'],
    ['IN_PROGRESS', 'pairing'],
    ['SOMETHING', 'unknown'],
    [undefined, 'unknown'],
    [42, 'unknown'],
  ])('maps the interview state %s to %s', (interviewState, setupState) => {
    const [device] = listed(
      translateDevices(
        json([
          {
            ieee_address: '0x00000000000000b1',
            friendly_name: 'x',
            interview_state: interviewState,
          },
        ]),
      ),
    );
    expect(device?.setupState).toBe(setupState);
    expect(device).toMatchObject({ vendor: '', model: '' });
  });

  it('keeps the valid entries when one is malformed, and drops only that one', () => {
    const [, first, second] = fixtureDevices;
    const hardware = listed(
      translateDevices(
        json([
          first,
          { ...second, friendly_name: 'x'.repeat(256) },
          { ...second, ieee_address: 'not-an-address' },
          { ...second, friendly_name: 42 },
          null,
          'text',
          {
            ieee_address: '0x00000000000000b1',
            friendly_name: 'failed interview',
            type: 'EndDevice',
            interview_state: 'FAILED',
            supported: false,
            definition: null,
          },
          second,
        ]),
      ),
    );
    expect(hardware.map((entry) => entry.name)).toEqual([
      first?.friendly_name,
      'failed interview',
      second?.friendly_name,
    ]);
  });

  it('lists nothing (all hardware removed) for an empty list', () => {
    expect(translateDevices(json([]))).toEqual([{ type: 'hardware.listed', hardware: [] }]);
  });

  it('lists only the coordinator as an empty list', () => {
    expect(translateDevices(json([fixtureDevices[0]]))).toEqual([
      { type: 'hardware.listed', hardware: [] },
    ]);
  });

  it.each([
    ['no JSON', 'not json'],
    ['not a list', '{"a":1}'],
    ['an entry without an address', '[{"friendly_name":"x"}]'],
    ['an address that is none', '[{"ieee_address":"nope","friendly_name":"x"}]'],
    ['nothing but garbage', '[null, "text", 1]'],
  ])('reports nothing for %s', (_label, payload) => {
    expect(translateDevices(Buffer.from(payload))).toEqual([]);
  });
});

describe('translateEvent', () => {
  it('reports hardware that joined, as pairing', () => {
    expect(
      translateEvent(
        json({
          type: 'device_joined',
          data: { friendly_name: '0x00000000000000c1', ieee_address: '0x00000000000000c1' },
        }),
      ),
    ).toEqual([
      {
        type: 'hardware.joined',
        externalId: '0x00000000000000c1',
        address: '0x00000000000000c1',
        name: '0x00000000000000c1',
      },
      { type: 'hardware.setup', externalId: '0x00000000000000c1', setupState: 'pairing' },
    ]);
  });

  it.each([
    ['started', 'pairing'],
    ['successful', 'ready'],
    ['failed', 'failed'],
  ])('reports the interview status %s as %s', (status, setupState) => {
    expect(
      translateEvent(
        json({
          type: 'device_interview',
          data: { friendly_name: 'Lampe', ieee_address: '0x00000000000000a7', status },
        }),
      ),
    ).toEqual([{ type: 'hardware.setup', externalId: '0x00000000000000a7', setupState }]);
  });

  it('reports hardware that left', () => {
    expect(
      translateEvent(
        json({
          type: 'device_leave',
          data: { friendly_name: 'Lampe', ieee_address: '0x00000000000000a7' },
        }),
      ),
    ).toEqual([{ type: 'hardware.left', externalId: '0x00000000000000a7' }]);
  });

  it('reports a rename as a new address and name', () => {
    expect(
      translateEvent(
        json({
          type: 'device_renamed',
          data: { from: 'Lampe', to: 'Stehlampe', homeassistant_rename: false },
        }),
      ),
    ).toEqual([
      { type: 'hardware.readdressed', from: 'Lampe', to: 'Stehlampe', name: 'Stehlampe' },
    ]);
  });

  it.each([
    ['another event', { type: 'device_announce', data: {} }],
    ['a malformed rename', { type: 'device_renamed', data: { from: 1 } }],
    ['a join without an address', { type: 'device_joined', data: { friendly_name: 'x' } }],
    [
      'an unknown interview status',
      { type: 'device_interview', data: { ieee_address: '0x00000000000000a7', status: 'x' } },
    ],
    ['a leave without data', { type: 'device_leave' }],
    ['no event', [1, 2]],
  ])('reports nothing for %s', (_label, event) => {
    expect(translateEvent(json(event))).toEqual([]);
  });

  it('reports nothing for a payload that is no JSON', () => {
    expect(translateEvent(Buffer.from('garbage'))).toEqual([]);
  });
});
