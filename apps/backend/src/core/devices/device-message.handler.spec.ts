import { Logger } from '@nestjs/common';
import type { Capability } from '@smart/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeasurementWriter } from '../telemetry/index.js';
import { DEVICE_STATE_CHANGED, DeviceEvents } from './device-events.js';
import { DeviceMessageProcessor } from './device-message.handler.js';
import type { DevicesRepository } from './devices.repository.js';
import type { HardwareRepository } from './hardware.repository.js';

const GW = 'gw-a1b2c3d4';
const HARDWARE = '0b6f3a8e-1c47-4d2a-8c11-5f0a9b7d3e21';
const DEVICE = '7d2c9e10-4b5a-4f3e-9a8d-1e6b0c2f4a55';
const NOW = new Date('2026-10-14T12:00:00.000Z');
const SEEN = '2026-10-14T11:59:00.000Z';

const capability = (key: string, kind: Capability['kind'], rest: Partial<Capability> = {}) => ({
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
  ...rest,
});
const CAPABILITIES: Capability[] = [
  capability('soil_moisture', 'numeric', { unit: '%' }),
  capability('battery', 'numeric'),
  capability('occupancy', 'binary'),
  capability('state', 'binary', { writable: true }),
  capability('mode', 'enum', { enumValues: ['eco', 'boost'] }),
  capability('label', 'text'),
  capability('color', 'composite'),
  capability('calibration', 'numeric', { writable: true, isSetting: true }),
  capability('trigger', 'numeric', { readable: false, writable: true }),
];

describe('DeviceMessageProcessor', () => {
  const capabilitiesOf = vi.fn<HardwareRepository['capabilitiesOf']>();
  const recordHardware = vi.fn<HardwareRepository['recordState']>();
  const activeBinding = vi.fn<DevicesRepository['activeBindingForHardware']>();
  const recordDevice = vi.fn<DevicesRepository['recordState']>();
  const add = vi.fn<MeasurementWriter['add']>();
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  let processor: DeviceMessageProcessor;
  let events: DeviceEvents;
  let changed: unknown[];

  const handle = (payload: Record<string, unknown>, retained = false, receivedAt = NOW) =>
    processor.handle(GW, HARDWARE, payload, receivedAt, retained);
  const stored = (): Record<string, unknown> | undefined => recordHardware.mock.calls[0]?.[1];

  beforeEach(() => {
    for (const mock of [capabilitiesOf, recordHardware, activeBinding, recordDevice, add]) {
      mock.mockReset();
    }
    warn.mockClear();
    capabilitiesOf.mockResolvedValue(CAPABILITIES);
    recordHardware.mockResolvedValue(true);
    recordDevice.mockResolvedValue(true);
    activeBinding.mockResolvedValue({
      id: 'b',
      deviceId: DEVICE,
      hardwareId: HARDWARE,
      boundAt: NOW,
      unboundAt: null,
    });
    events = new DeviceEvents();
    changed = [];
    events.on(DEVICE_STATE_CHANGED, (event) => changed.push(event));
    processor = new DeviceMessageProcessor(
      { capabilitiesOf, recordState: recordHardware } as unknown as HardwareRepository,
      {
        activeBindingForHardware: activeBinding,
        recordState: recordDevice,
      } as unknown as DevicesRepository,
      { add } as unknown as MeasurementWriter,
      events,
    );
  });

  it('without a device only keeps the hardware last state', async () => {
    activeBinding.mockResolvedValue(undefined);
    await handle({ soil_moisture: 31, last_seen: SEEN });

    expect(recordHardware).toHaveBeenCalledWith(HARDWARE, { soil_moisture: 31 }, new Date(SEEN), {
      strictlyNewer: false,
    });
    expect(recordDevice).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('announces a changed device state, and stays silent when nothing was stored', async () => {
    await handle({ soil_moisture: 31 });
    expect(changed).toEqual([{ deviceId: DEVICE }]);

    changed.length = 0;
    recordDevice.mockResolvedValue(false);
    await handle({ soil_moisture: 30 });
    activeBinding.mockResolvedValue(undefined);
    await handle({ soil_moisture: 29 });
    expect(changed).toEqual([]);
  });

  it('with a device updates its state and stores readings at the measurement time', async () => {
    await handle({ soil_moisture: 31.5, occupancy: true, mode: 'eco', last_seen: SEEN });

    expect(recordDevice).toHaveBeenCalledWith(
      DEVICE,
      { soil_moisture: 31.5, occupancy: true, mode: 'eco' },
      new Date(SEEN),
    );
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]?.[0]).toEqual([
      {
        time: new Date(SEEN),
        deviceId: DEVICE,
        capability: 'soil_moisture',
        valueNum: 31.5,
        flags: [],
      },
      { time: new Date(SEEN), deviceId: DEVICE, capability: 'occupancy', valueNum: 1, flags: [] },
      { time: new Date(SEEN), deviceId: DEVICE, capability: 'mode', valueText: 'eco', flags: [] },
    ]);
  });

  it('stores binary readings as 0 and 1 and accepts the ON/OFF of switches and lights', async () => {
    await handle({ occupancy: false, state: 'ON', last_seen: SEEN });
    await handle({ state: 'OFF', last_seen: SEEN });

    const rows = add.mock.calls.flatMap(([batch]) => batch);
    expect(rows.map((row) => [row.capability, row.valueNum])).toEqual([
      ['occupancy', 0],
      ['state', 1],
      ['state', 0],
    ]);
  });

  it('flags a reading whose time was replaced by the receive time', async () => {
    await handle({ soil_moisture: 20, last_seen: '1970-01-01T00:00:00Z' });
    await handle({ soil_moisture: 21 });

    expect(add.mock.calls.map(([batch]) => batch[0])).toEqual([
      expect.objectContaining({ time: NOW, flags: ['time_replaced'] }),
      expect.objectContaining({ time: NOW, flags: ['time_replaced'] }),
    ]);
    expect(recordHardware.mock.calls[0]?.[2]).toEqual(NOW);
  });

  it('drops invalid fields, keeps the rest and counts them without logging values', async () => {
    await handle({
      soil_moisture: '31',
      battery: Number.POSITIVE_INFINITY,
      occupancy: 1,
      mode: 'turbo-secret',
      label: 'x\u0000y',
      color: 'red',
      unknown_key: 5,
      calibration_extra: 1,
      trigger: 1,
      last_seen: SEEN,
    });
    await handle({ soil_moisture: 12, battery: null, last_seen: SEEN });

    expect(stored()).toEqual({});
    expect(recordHardware.mock.calls[1]?.[1]).toEqual({ soil_moisture: 12 });
    expect(processor.discardedFields).toBe(7);
    expect(String(warn.mock.calls)).not.toMatch(/turbo|secret|31/);
  });

  it('keeps settings and unreadable properties in the state but out of the measurements', async () => {
    await handle({ calibration: 4, soil_moisture: 30, label: 'plant', color: { x: 0.3, y: 0.4 } });

    expect(recordDevice.mock.calls[0]?.[1]).toEqual({
      calibration: 4,
      soil_moisture: 30,
      label: 'plant',
      color: { x: 0.3, y: 0.4 },
    });
    // Text and composite values live in the state only, never in the measurements.
    expect(add.mock.calls[0]?.[0].map((row) => row.capability)).toEqual(['soil_moisture']);
  });

  it('drops a composite with a NUL character anywhere in it, and only that field', async () => {
    await handle({
      soil_moisture: 30,
      color: { x: 0.3, nested: [{ name: 'a\u0000b' }] },
      last_seen: SEEN,
    });
    await handle({ soil_moisture: 31, color: { ['k\u0000']: 1 }, last_seen: SEEN });
    await handle({ soil_moisture: 32, color: { x: 0.3, y: 0.4 }, last_seen: SEEN });

    expect(recordDevice.mock.calls.map((call) => call[1])).toEqual([
      { soil_moisture: 30 },
      { soil_moisture: 31 },
      { soil_moisture: 32, color: { x: 0.3, y: 0.4 } },
    ]);
    expect(processor.discardedFields).toBe(2);
  });

  describe('a retained message', () => {
    it('is not a reading seen now: without its own plausible last_seen it changes nothing', async () => {
      await handle({ soil_moisture: 30 }, true);
      await handle({ soil_moisture: 30, last_seen: '2026-10-01T00:00:00Z' }, true);

      expect(recordHardware).not.toHaveBeenCalled();
      expect(recordDevice).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    });

    it('with a last_seen newer than the stored one is processed like a fresh message', async () => {
      await handle({ soil_moisture: 30, last_seen: SEEN }, true);

      expect(recordHardware).toHaveBeenCalledWith(HARDWARE, { soil_moisture: 30 }, new Date(SEEN), {
        strictlyNewer: true,
      });
      expect(recordDevice).toHaveBeenCalledTimes(1);
      expect(add).toHaveBeenCalledTimes(1);
    });

    it('with a last_seen that is not newer than the stored one is dropped entirely', async () => {
      recordHardware.mockResolvedValue(false);
      await handle({ soil_moisture: 30, last_seen: SEEN }, true);

      expect(recordDevice).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    });
  });
});
