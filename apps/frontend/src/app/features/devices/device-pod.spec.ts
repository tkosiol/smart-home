import {
  capability,
  device,
  dry,
  linkquality,
  moisture,
  temperature,
  battery,
} from './devices-testing';
import { podOf } from './device-pod';

const NBSP = String.fromCharCode(0xa0);
const pod = (...args: Parameters<typeof device>) => podOf(device(...args), 'de');

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
      state: { state: 'ON' },
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
      state: { state: 'OFF' },
    });
    expect(off.valueKey).toBe('app.devices.pod.off');
  });

  it('marks soil below the effective minimum as dry and above the maximum as wet', () => {
    const thresholds = { soilMoistureMin: 25, soilMoistureMax: 80 };
    const base = device('d1', 'A').effectiveThresholds;
    const effective = { ...base, ...thresholds };
    expect(
      pod('d1', 'A', { state: { soil_moisture: 18 }, effectiveThresholds: effective }).chip,
    ).toEqual({
      key: 'app.devices.pod.dry',
      tone: 'dry',
    });
    expect(
      pod('d1', 'A', { state: { soil_moisture: 91 }, effectiveThresholds: effective }).chip,
    ).toEqual({
      key: 'app.devices.pod.wet',
      tone: 'wet',
    });
    expect(
      pod('d1', 'A', { state: { soil_moisture: 25 }, effectiveThresholds: effective }).chip,
    ).toEqual({
      key: 'app.devices.pod.ok',
      tone: 'ok',
    });
  });

  it('marks a device that reports "dry" as dry whatever the moisture says', () => {
    expect(pod('d1', 'A', { state: { soil_moisture: 60, dry: true } }).chip?.key).toBe(
      'app.devices.pod.dry',
    );
  });

  it('shows a low battery by the effective threshold of the device', () => {
    const base = device('d1', 'A').effectiveThresholds;
    const low = pod('d1', 'A', {
      state: { soil_moisture: 60, battery: 14 },
      effectiveThresholds: { ...base, batteryMin: 15 },
    });
    expect(low.chip).toEqual({ key: 'app.devices.pod.lowBattery', tone: 'warning' });
    const fine = pod('d1', 'A', {
      state: { soil_moisture: 60, battery: 14 },
      effectiveThresholds: { ...base, batteryMin: 10 },
    });
    expect(fine.chip?.key).toBe('app.devices.pod.ok');
  });

  it('shows no chip while the device has not reported a reading yet', () => {
    expect(pod('d1', 'A', { state: {}, lastSeenAt: null }).chip).toBeNull();
    // Only a battery level says nothing about the soil: still no "OK".
    expect(pod('d1', 'A', { state: { battery: 90 } }).chip).toBeNull();
    // But it can still say the battery is low.
    expect(pod('d1', 'A', { state: { battery: 5 } }).chip?.key).toBe('app.devices.pod.lowBattery');
  });

  it('says offline before anything else', () => {
    expect(
      pod('d1', 'A', { availability: 'offline', state: { soil_moisture: 10, battery: 3 } }).chip,
    ).toEqual({ key: 'app.devices.pod.offline', tone: 'error' });
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
