import type { Device } from '@smart/contracts';
import {
  capability,
  device,
  dry,
  linkquality,
  moisture,
  temperature,
  battery,
} from './devices-testing';
import { NO_NOTICES, UNKNOWN_NOTICES, type DeviceNotices } from './device-notices';
import { podOf } from './device-pod';

const NBSP = String.fromCharCode(0xa0);
const pod = (id: string, name: string, overrides: Partial<Device> = {}, flags = NO_NOTICES) =>
  podOf(device(id, name, overrides), 'de', flags);
const notices = (overrides: Partial<DeviceNotices>): DeviceNotices => ({
  ...NO_NOTICES,
  ...overrides,
});

describe('podOf', () => {
  it('shows the soil moisture as the value with the temperature beside the name', () => {
    expect(pod('d1', 'Monstera')).toEqual({
      kind: 'soil',
      icon: 'potted_plant',
      value: '41,3',
      unit: '%',
      label: `Monstera · 21,5${NBSP}°C`,
      chip: { key: 'app.devices.pod.ok', tone: 'ok' },
      route: '/geraete/d1',
    });
  });

  it('takes the kind from the server, not from the capabilities', () => {
    const lamp = pod('d2', 'Lampe', {
      kind: 'light',
      capabilities: [capability('state', { kind: 'binary', writable: true })],
      state: { state: true },
    });
    expect(lamp).toMatchObject({
      kind: 'light',
      icon: 'lightbulb',
      value: '',
      valueKey: 'app.devices.pod.on',
      route: '/geraete/d2',
    });
    expect(lamp.chip).toBeNull();
    expect(lamp.unit).toBeUndefined();
    const off = pod('d2', 'Lampe', {
      kind: 'light',
      capabilities: [capability('state', { kind: 'binary', writable: true })],
      state: { state: false },
    });
    expect(off.valueKey).toBe('app.devices.pod.off');
  });

  it('follows the notices of the device: dry, wet, low battery, else OK', () => {
    expect(pod('d1', 'A', {}, notices({ dry: true })).chip).toEqual({
      key: 'app.devices.pod.dry',
      tone: 'dry',
    });
    expect(pod('d1', 'A', {}, notices({ wet: true })).chip).toEqual({
      key: 'app.devices.pod.wet',
      tone: 'wet',
    });
    expect(pod('d1', 'A', {}, notices({ batteryLow: true })).chip).toEqual({
      key: 'app.devices.pod.lowBattery',
      tone: 'warning',
    });
    expect(pod('d1', 'A').chip).toEqual({ key: 'app.devices.pod.ok', tone: 'ok' });
  });

  it('does not decide dry itself: the item rules, with its hysteresis', () => {
    const withMin = { ...device('d1', 'A').effectiveThresholds, soilMoistureMin: 25 };
    // 26 % is above the minimum of 25 %, but the dry item is still open.
    const held = pod(
      'd1',
      'A',
      { state: { soil_moisture: 26 }, effectiveThresholds: withMin },
      notices({ dry: true }),
    );
    expect(held.chip?.key).toBe('app.devices.pod.dry');
    // 24 % is below the minimum, but the server has opened no item (yet).
    const below = pod('d1', 'A', { state: { soil_moisture: 24 }, effectiveThresholds: withMin });
    expect(below.chip?.key).toBe('app.devices.pod.ok');
  });

  it('says nothing, not even OK, while the server has not told yet', () => {
    expect(pod('d1', 'A', {}, UNKNOWN_NOTICES).chip).toBeNull();
    // Offline needs no list.
    const offline = pod('d1', 'A', { availability: 'offline' }, UNKNOWN_NOTICES);
    expect(offline.chip?.key).toBe('app.devices.pod.offline');
  });

  it('shows a dry item before a battery one', () => {
    expect(pod('d1', 'A', {}, notices({ dry: true, batteryLow: true })).chip?.key).toBe(
      'app.devices.pod.dry',
    );
  });

  it('shows no chip while the device has not reported a reading yet', () => {
    expect(pod('d1', 'A', { state: {}, lastSeenAt: null }).chip).toBeNull();
    // Only a battery level says nothing about the soil: still no "OK".
    expect(pod('d1', 'A', { state: { battery: 90 } }).chip).toBeNull();
    // But the server can still say the battery is low.
    const low = pod('d1', 'A', { state: { battery: 5 } }, notices({ batteryLow: true }));
    expect(low.chip?.key).toBe('app.devices.pod.lowBattery');
  });

  it('says offline before anything else', () => {
    const offline = pod(
      'd1',
      'A',
      { availability: 'offline', state: { soil_moisture: 10, battery: 3 } },
      notices({ dry: true, batteryLow: true }),
    );
    expect(offline.chip).toEqual({ key: 'app.devices.pod.offline', tone: 'error' });
  });

  it('shows a dash for a value that is not there yet, and no unit', () => {
    const empty = pod('d1', 'A', {
      state: {},
      capabilities: [moisture, temperature, battery, linkquality, dry],
    });
    expect(empty).toMatchObject({ value: '–', label: 'A' });
    expect(empty.unit).toBeUndefined();
  });

  it('uses the first reading as the value of a device without soil moisture', () => {
    const climate = pod('d3', 'Flur', {
      kind: 'climate',
      capabilities: [temperature, capability('humidity', { unit: '%' })],
      state: { temperature: 22.14, humidity: 48 },
    });
    expect(climate).toMatchObject({
      kind: 'climate',
      icon: 'thermostat',
      value: '22,1',
      unit: '°C',
      label: `Flur · 48${NBSP}%`,
      chip: null,
    });
  });

  it('formats in the language of the user', () => {
    expect(podOf(device('d1', 'A'), 'en').value).toBe('41.3');
  });
});
