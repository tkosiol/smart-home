import { describe, expect, it } from 'vitest';
import { loadFixtureDevices, type Z2mDevice, type Z2mExpose } from './fixtures.js';
import { GatewaySimulation, LAMP, PLANT_MODEL, type Report } from './model.js';

const fixtures = loadFixtureDevices();
const START = new Date('2026-10-01T00:00:00.000Z');
const STEP_SECONDS = 300;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** All exposes that carry a value, the members of a composite included, by their property name. */
function exposesByProperty(device: Z2mDevice): Map<string, Z2mExpose> {
  const found = new Map<string, Z2mExpose>();
  const visit = (expose: Z2mExpose): void => {
    if (expose.type === 'light' || expose.type === 'composite') {
      expose.features?.forEach(visit);
      return;
    }
    if (expose.property) found.set(expose.property, expose);
  };
  device.definition?.exposes.forEach(visit);
  return found;
}

function deviceNamed(name: string): Z2mDevice {
  const device = fixtures.find((entry) => entry.friendly_name === name);
  if (!device) throw new Error(`no fixture ${name}`);
  return device;
}

/** Ranges the definition leaves open but that a measurement must keep to. */
const PLAUSIBLE: Record<string, [number, number]> = {
  soil_moisture: [0, 100],
  humidity: [0, 100],
  temperature: [-20, 60],
};

/** What is wrong with a state message compared with the definition of its device (nothing when empty). */
function violations(device: Z2mDevice, report: Report): string[] {
  const exposes = exposesByProperty(device);
  const { last_seen: lastSeen, ...values } = report.payload;
  const found: string[] = [];
  if (typeof lastSeen !== 'string' || !ISO_UTC.test(lastSeen))
    found.push(`last_seen ${String(lastSeen)}`);
  if (Object.keys(values).length === 0) found.push('no values');
  for (const [property, value] of Object.entries(values)) {
    const expose = exposes.get(property);
    const where = `${device.friendly_name}.${property}=${JSON.stringify(value)}`;
    if (!expose) {
      found.push(`${where} is not exposed`);
      continue;
    }
    if (((expose.access ?? 0) & 1) !== 1) found.push(`${where} is not readable`);
    switch (expose.type) {
      case 'numeric':
        if (typeof value !== 'number' || !Number.isFinite(value))
          found.push(`${where} is no number`);
        else if (
          value < (PLAUSIBLE[property]?.[0] ?? -Infinity) ||
          value > (PLAUSIBLE[property]?.[1] ?? Infinity) ||
          (expose.value_min !== undefined && value < expose.value_min) ||
          (expose.value_max !== undefined && value > expose.value_max)
        ) {
          found.push(`${where} is out of range`);
        }
        break;
      case 'binary':
        if (value !== expose.value_on && value !== expose.value_off)
          found.push(`${where} is no binary value`);
        break;
      case 'enum':
        if (!expose.values?.includes(value as string))
          found.push(`${where} is not one of the values`);
        break;
      default:
        found.push(`${where} has the unexpected expose type ${expose.type}`);
    }
  }
  return found;
}

function expectValidState(device: Z2mDevice, report: Report): void {
  expect(violations(device, report)).toEqual([]);
}

describe('fixtures', () => {
  it('hold six soil sensors, one lamp and a generic coordinator with invented identifiers', () => {
    expect(fixtures.filter((d) => d.definition?.model === PLANT_MODEL)).toHaveLength(6);
    expect(fixtures.filter((d) => d.definition?.model === 'LED1624G9')).toHaveLength(1);
    expect(fixtures.filter((d) => d.type === 'Coordinator')).toHaveLength(1);
    expect(fixtures.map((d) => d.friendly_name)).toEqual([
      'Coordinator',
      ...[1, 2, 3, 4, 5, 6].map((n) => `Pflanze ${n}`),
      'Lampe',
    ]);
    for (const device of fixtures) expect(device.ieee_address).toMatch(/^0x00000000000000a[0-7]$/);
  });
});

describe('GatewaySimulation messages', () => {
  it('reports every sensor with fields and types of its Z2M definition', () => {
    const reports = new GatewaySimulation(fixtures, 1, new Date('2026-10-01T12:00:00.000Z')).tick(
      new Date('2026-10-01T12:05:00.000Z'),
    );
    const names = fixtures.filter((d) => d.type !== 'Coordinator').map((d) => d.friendly_name);
    expect(reports.map((r) => r.topic).sort()).toEqual([...names].sort());
    for (const report of reports) {
      expect(report.retain).toBe(false);
      expectValidState(deviceNamed(report.topic), report);
    }
  });

  it('reports the measured values of a soil sensor', () => {
    const [report] = new GatewaySimulation(fixtures, 1, START).tick(
      new Date('2026-10-01T12:00:00.000Z'),
    );
    expect(Object.keys(report?.payload ?? {})).toEqual(
      expect.arrayContaining([
        'soil_moisture',
        'temperature',
        'humidity',
        'battery',
        'linkquality',
        'dry',
        'last_seen',
      ]),
    );
  });

  it('announces availability as retained online messages for every device', () => {
    const availability = new GatewaySimulation(
      fixtures,
      1,
      new Date('2026-10-01T12:00:00.000Z'),
    ).availability();
    expect(availability).toHaveLength(7);
    for (const report of availability) {
      expect(report.topic).toMatch(/\/availability$/);
      expect(report.retain).toBe(true);
      expect(report.payload).toEqual({ state: 'online' });
    }
  });
});

describe('GatewaySimulation over 30 days', () => {
  const runs = new Map<number, Report[]>();
  function run(seed: number): { reports: Report[] } {
    const known = runs.get(seed);
    if (known) return { reports: known };
    const simulation = new GatewaySimulation(fixtures, seed, START);
    const reports: Report[] = [];
    const steps = (30 * 24 * 3600) / STEP_SECONDS;
    for (let step = 1; step <= steps; step += 1) {
      reports.push(...simulation.tick(new Date(START.getTime() + step * STEP_SECONDS * 1000)));
    }
    runs.set(seed, reports);
    return { reports };
  }

  it('keeps every value inside the range of its expose and the soil moisture within 0 to 100', () => {
    const devices = new Map(fixtures.map((device) => [device.friendly_name, device]));
    const found: string[] = [];
    for (const seed of [1, 2, 3]) {
      for (const report of run(seed).reports) {
        if (report.topic.endsWith('/availability')) continue;
        found.push(...violations(devices.get(report.topic) as Z2mDevice, report));
      }
    }
    expect(found).toEqual([]);
  });

  it('keeps the temperature plausible and lets the soil moisture jump on watering (70 to 90)', () => {
    const { reports } = run(7);
    const states = reports.filter((r) => r.topic === 'Pflanze 2');
    const temperatures = states.map((r) => r.payload['temperature'] as number);
    expect(Math.min(...temperatures)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...temperatures)).toBeLessThanOrEqual(35);
    const moisture = states.map((r) => r.payload['soil_moisture'] as number);
    const jumps = moisture.flatMap((value, index) =>
      index > 0 && value - (moisture[index - 1] ?? value) > 10 ? [value] : [],
    );
    // Every 3 to 5 days: between 6 and 10 waterings in 30 days (the first one comes earlier).
    expect(jumps.length).toBeGreaterThanOrEqual(6);
    expect(jumps.length).toBeLessThanOrEqual(11);
    for (const value of jumps) {
      expect(value).toBeGreaterThanOrEqual(70);
      expect(value).toBeLessThanOrEqual(90);
    }
  });

  it('dries the soil by 0.5 to 2 points an hour between two waterings', () => {
    const simulation = new GatewaySimulation(fixtures, 11, START);
    const seen: number[] = [];
    for (let hour = 1; hour <= 6; hour += 1) {
      const report = simulation
        .tick(new Date(START.getTime() + hour * 3_600_000))
        .find((r) => r.topic === 'Pflanze 3');
      if (report) seen.push(report.payload['soil_moisture'] as number);
    }
    for (let i = 1; i < seen.length; i += 1) {
      const drop = (seen[i - 1] as number) - (seen[i] as number);
      // Rounded to whole points, so a little room on both sides.
      expect(drop).toBeGreaterThanOrEqual(0);
      expect(drop).toBeLessThanOrEqual(3);
    }
  });

  it('lets the battery fall slowly and never rise', () => {
    const { reports } = run(5);
    const battery = reports
      .filter((r) => r.topic === 'Pflanze 1')
      .map((r) => r.payload['battery'] as number);
    expect(battery.length).toBeGreaterThan(1000);
    for (let i = 1; i < battery.length; i += 1) {
      expect(battery[i] as number).toBeLessThanOrEqual(battery[i - 1] as number);
    }
    expect((battery[0] as number) - (battery.at(-1) as number)).toBeLessThanOrEqual(10);
  });

  it('takes exactly one sensor offline for one hour a day', () => {
    const { reports } = run(9);
    const changes = reports.filter((r) => r.topic.endsWith('/availability'));
    expect(new Set(changes.map((r) => r.topic)).size).toBe(1);
    const states = changes.map((r) => (r.payload as { state: string }).state);
    // 30 days: offline and back online each day (the first offline hour may start on the first day).
    expect(states.filter((s) => s === 'offline').length).toBeGreaterThanOrEqual(29);
    expect(states.filter((s) => s === 'online').length).toBeGreaterThanOrEqual(29);
    for (const report of changes) expect(report.retain).toBe(true);
  });

  it('sends nothing for the sensor while it is offline', () => {
    const { reports } = run(9);
    const offline = reports.find((r) => (r.payload as { state?: string }).state === 'offline');
    const name = offline?.topic.replace('/availability', '');
    const offlineHours = new Set<number>();
    for (const r of reports.filter((x) => x.topic === name)) {
      offlineHours.add(new Date(r.payload['last_seen'] as string).getUTCHours());
    }
    expect(offlineHours.size).toBe(23);
  });

  it('is deterministic for the same seed and differs between seeds', () => {
    const a = run(21).reports;
    const b = run(21).reports;
    const c = run(22).reports;
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe('the lamp', () => {
  const T = new Date('2026-10-01T12:00:00.000Z');

  it('reports its state with the fields of its definition', () => {
    const report = new GatewaySimulation(fixtures, 1, T).tick(T).find((r) => r.topic === 'Lampe');
    expect(report?.payload).toMatchObject({ state: 'OFF', brightness: 254, color_temp: 370 });
  });

  it('takes over state, brightness and color_temp of a set message and reports the new state', () => {
    const simulation = new GatewaySimulation(fixtures, 1, T);
    const reports = simulation.set('Lampe', { state: 'ON', brightness: 120, color_temp: 300 }, T);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      topic: 'Lampe',
      retain: false,
      payload: { state: 'ON', brightness: 120, color_temp: 300, last_seen: T.toISOString() },
    });
    expectValidState(deviceNamed('Lampe'), reports[0] as Report);
    // The lamp keeps the state for its next regular report.
    expect(simulation.tick(T).find((r) => r.topic === 'Lampe')?.payload).toMatchObject({
      state: 'ON',
      brightness: 120,
    });
  });

  it('keeps the values inside the range of the definition', () => {
    const simulation = new GatewaySimulation(fixtures, 1, T);
    const [high] = simulation.set('Lampe', { brightness: 9999, color_temp: 9999 }, T);
    expect(high?.payload).toMatchObject({
      brightness: LAMP.brightnessMax,
      color_temp: LAMP.colorTempMax,
    });
    const [low] = simulation.set('Lampe', { brightness: -5, color_temp: 1 }, T);
    expect(low?.payload).toMatchObject({
      brightness: 0,
      color_temp: LAMP.colorTempMin,
      state: 'OFF',
    });
  });

  it('toggles and switches on and off', () => {
    const simulation = new GatewaySimulation(fixtures, 1, T);
    expect(simulation.set('Lampe', { state: 'TOGGLE' }, T)[0]?.payload).toMatchObject({
      state: 'ON',
    });
    expect(simulation.set('Lampe', { state: 'OFF' }, T)[0]?.payload).toMatchObject({
      state: 'OFF',
    });
    expect(simulation.set('Lampe', { state: 'on' }, T)[0]?.payload).toMatchObject({ state: 'ON' });
  });

  it.each([null, 'ON', 5, [], {}, { state: 'maybe' }, { brightness: 'x' }, { unknown: 1 }])(
    'ignores the unusable command %j',
    (command) => {
      expect(new GatewaySimulation(fixtures, 1, T).set('Lampe', command, T)).toEqual([]);
    },
  );

  it('ignores commands for devices that are not the lamp', () => {
    const simulation = new GatewaySimulation(fixtures, 1, T);
    expect(simulation.set('Pflanze 1', { state: 'ON' }, T)).toEqual([]);
    expect(simulation.set('Unknown', { state: 'ON' }, T)).toEqual([]);
  });
});
