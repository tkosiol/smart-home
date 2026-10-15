import { effectiveThresholds } from '@smart/contracts';
import { heroOf, sidePodsOf } from './device-hero';
import { capability, device, dry } from './devices-testing';

describe('heroOf', () => {
  it('takes the main value, its name and the status of the device', () => {
    const hero = heroOf(
      device('d', 'Ficus', { state: { soil_moisture: 12.34, battery: 90 } }),
      'de',
    );
    expect(hero).toMatchObject({
      kind: 'soil',
      capabilityKey: 'soil_moisture',
      value: '12,3',
      unit: '%',
      missing: false,
      chip: { key: 'app.devices.pod.dry', tone: 'dry' },
    });
  });

  it('has a meter with the target range between the limits that are set', () => {
    const base = device('d', 'Ficus', { state: { soil_moisture: 40 } });
    const withMax = {
      ...base,
      effectiveThresholds: { ...base.effectiveThresholds, soilMoistureMax: 60 },
    };
    expect(heroOf(withMax, 'de').meter).toMatchObject({
      value: 40,
      band: { from: 25, to: 60, tone: 'ok' },
      textKey: 'app.devices.hero.meter.ok',
      textParams: { from: '25', to: '60' },
    });
    // Only a lower limit: the range runs up to the top of the scale.
    expect(heroOf(base, 'de').meter?.band).toEqual({ from: 25, to: 100, tone: 'ok' });
  });

  it('says dry, wet or ok by the limits', () => {
    const at = (moisture: number) =>
      heroOf(
        {
          ...device('d', 'x', { state: { soil_moisture: moisture } }),
          effectiveThresholds: { ...effectiveThresholds('soil', {}), soilMoistureMax: 70 },
        },
        'de',
      ).meter?.textKey;
    expect(at(10)).toBe('app.devices.hero.meter.dry');
    expect(at(25)).toBe('app.devices.hero.meter.ok');
    expect(at(70)).toBe('app.devices.hero.meter.ok');
    expect(at(71)).toBe('app.devices.hero.meter.wet');
  });

  it('has no band when no limit is set', () => {
    const none = device('d', 'x', {
      state: { soil_moisture: 40 },
      effectiveThresholds: {
        ...effectiveThresholds('soil', {}),
        soilMoistureMin: null,
        soilMoistureMax: null,
      },
    });
    expect(heroOf(none, 'de').meter).toMatchObject({
      band: null,
      textKey: 'app.devices.hero.meter.plain',
    });
  });

  it('has no meter for another kind or without a moisture value', () => {
    expect(heroOf(device('d', 'x', { kind: 'climate' }), 'de').meter).toBeNull();
    expect(heroOf(device('d', 'x', { state: {} }), 'de')).toMatchObject({
      meter: null,
      missing: true,
      value: '–',
    });
  });

  it('says a switch in words', () => {
    const lamp = device('d', 'Lampe', {
      kind: 'light',
      capabilities: [capability('state', { kind: 'binary', writable: true })],
      state: { state: 'ON' },
    });
    expect(heroOf(lamp, 'de')).toMatchObject({ valueKey: 'app.devices.pod.on', missing: false });
  });

  it('has no main reading for a device that reports nothing readable', () => {
    expect(heroOf(device('d', 'x', { capabilities: [], state: {} }), 'de').capabilityKey).toBe(
      undefined,
    );
  });
});

describe('sidePodsOf', () => {
  it('shows temperature, battery and signal after the moisture', () => {
    const pods = sidePodsOf(device('d', 'x'), 'de');
    expect(pods.map((pod) => [pod.key, pod.value, pod.unit])).toEqual([
      ['temperature', '21,5', '°C'],
      ['battery', '87', '%'],
      ['linkquality', '120', undefined],
    ]);
    expect(pods[0]).toMatchObject({
      labelKey: 'app.devices.capability.temperature',
      icon: 'thermostat',
    });
  });

  it('shows at most three, takes the next readings for other devices and skips settings', () => {
    const sensor = device('d', 'x', {
      kind: 'climate',
      capabilities: [
        capability('temperature'),
        capability('humidity'),
        capability('pressure'),
        capability('co2'),
        capability('calibration', { isSetting: true }),
      ],
      state: { temperature: 20, humidity: 40, pressure: 1000, co2: 500, calibration: 1 },
    });
    expect(sidePodsOf(sensor, 'de').map((pod) => pod.key)).toEqual(['humidity', 'pressure', 'co2']);
  });

  it('names a reading the app does not know by its key and leaves the main one out', () => {
    const odd = device('d', 'x', {
      kind: 'other',
      capabilities: [capability('co2'), dry],
      state: { co2: 500, dry: true },
    });
    const pods = sidePodsOf(odd, 'de');
    expect(pods.map((pod) => pod.key)).toEqual(['dry']);
    expect(pods[0]).toMatchObject({
      valueKey: 'app.devices.pod.dry',
      labelKey: 'app.devices.capability.dry',
    });
    expect(
      sidePodsOf(device('d', 'x', { capabilities: [capability('co2')], state: {} }), 'de'),
    ).toEqual([]);
  });
});
