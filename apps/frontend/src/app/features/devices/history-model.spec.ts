import { capability, device, historyOf, moisture, temperature, battery } from './devices-testing';
import {
  chartViewOf,
  historyCapabilities,
  pointLabel,
  summaryOf,
  tableRowsOf,
  thresholdFor,
  withUnit,
} from './history-model';

const NBSP = String.fromCharCode(0xa0);
const BERLIN = 'Europe/Berlin';
const humidity = capability('humidity', { unit: '%' });

describe('historyCapabilities', () => {
  it('lists readable numeric readings, main value first, then the usual ones, then the rest', () => {
    const lq = capability('linkquality');
    const sample = device('d', 'Sensor', {
      capabilities: [
        lq,
        battery,
        capability('soil_calibration', { isSetting: true }),
        capability('dry', { kind: 'binary' }),
        capability('identify', { readable: false }),
        humidity,
        temperature,
        moisture,
      ],
    });
    expect(historyCapabilities(sample).map((c) => c.key)).toEqual([
      'soil_moisture',
      'temperature',
      'humidity',
      'battery',
      'linkquality',
    ]);
  });

  it('is empty for a device without a numeric reading', () => {
    expect(historyCapabilities(device('d', 'x', { capabilities: [] }))).toEqual([]);
  });
});

describe('thresholdFor', () => {
  it('is the effective minimum for soil moisture only', () => {
    const sample = device('d', 'x');
    expect(thresholdFor(sample, 'soil_moisture')).toBe(25);
    expect(thresholdFor(sample, 'temperature')).toBeNull();
    const none = device('d', 'x', {
      effectiveThresholds: { ...sample.effectiveThresholds, soilMoistureMin: null },
    });
    expect(thresholdFor(none, 'soil_moisture')).toBeNull();
  });
});

describe('chartViewOf', () => {
  it('draws soil moisture as an area from 0 to 80 with the band and the waterings', () => {
    const history = historyOf('soil_moisture', '7d', (i) => (i < 100 ? 20 : i === 100 ? 45 : 40));
    const view = chartViewOf(history, 25);
    expect(view.kind).toBe('area');
    expect(view.domain).toEqual({ min: 0, max: 80 });
    expect(view.band).toBe(25);
    expect(view.resolutionMinutes).toBe(60);
    expect(view.points).toHaveLength(168);
    expect(view.points[0]).toEqual({ t: history.points[0]!.t, value: 20 });
    expect(view.markers).toEqual([history.points[100]!.t]);
  });

  it('has no band without a threshold (Review Focus 4)', () => {
    const history = historyOf('soil_moisture', '24h', () => 10);
    const view = chartViewOf(history, null);
    expect(view.band).toBeNull();
    expect(view.resolutionMinutes).toBe(15);
  });

  it('draws temperature as an area, and over 4 weeks as a ribbon of the daily values', () => {
    const week = chartViewOf(historyOf('temperature', '7d'), null);
    expect(week.kind).toBe('area');
    expect(week.domain).toBeNull();
    expect(week.markers).toEqual([]);
    const history = historyOf('temperature', '28d', (i) => 20 + (i % 24) / 10);
    const month = chartViewOf(history, null);
    expect(month.kind).toBe('ribbon');
    expect(month.points).toHaveLength(28);
    expect(month.resolutionMinutes).toBe(1440);
    const day = history.days[0]!;
    expect(month.points[0]).toMatchObject({ value: day.avg, min: day.min, max: day.max });
    expect(month.points[0]!.t.endsWith('T12:00:00.000Z')).toBe(true);
  });

  it('draws the battery as steps of its last value', () => {
    const history = historyOf('battery', '7d', (i) => 90 - Math.floor(i / 50));
    const view = chartViewOf(history, null);
    expect(view.kind).toBe('step');
    expect(view.points[0]!.value).toBe(history.points[0]!.last);
  });
});

describe('summaryOf', () => {
  const sizes = (
    history = historyOf('soil_moisture', '7d', (i) => (i < 100 ? 20 : i === 100 ? 45 : 40)),
  ) => history;

  it('names low, high, the time too dry and the waterings', () => {
    const parts = summaryOf(sizes(), 25, 'de');
    expect(parts.map((p) => p.key)).toEqual([
      'app.devices.history.summary.low',
      'app.devices.history.summary.high',
      'app.devices.history.summary.dryHours',
      'app.devices.history.summary.waterings',
    ]);
    expect(parts[0]!.params).toEqual({ value: `19${NBSP}%` });
    expect(parts[1]!.params).toEqual({ value: `46${NBSP}%` });
    expect(parts[2]!.params).toEqual({ n: 100 });
    expect(parts[3]!.params).toEqual({ n: 1 });
  });

  it('shows minutes below an hour', () => {
    const parts = summaryOf(
      historyOf('soil_moisture', '24h', (i) => (i < 2 ? 20 : 40)),
      25,
      'de',
    );
    expect(parts.find((p) => p.key.endsWith('dryMinutes'))?.params).toEqual({ n: 30 });
  });

  it('leaves out what does not apply: no threshold, nothing dry, no waterings, other values', () => {
    const none = summaryOf(sizes(), null, 'de').map((p) => p.key);
    expect(none).toEqual([
      'app.devices.history.summary.low',
      'app.devices.history.summary.high',
      'app.devices.history.summary.waterings',
    ]);
    const calm = summaryOf(
      historyOf('soil_moisture', '7d', () => 40),
      25,
      'de',
    ).map((p) => p.key);
    expect(calm).toEqual(['app.devices.history.summary.low', 'app.devices.history.summary.high']);
    const temp = summaryOf(
      historyOf('temperature', '7d', (i) => (i < 100 ? 5 : 30), '°C'),
      25,
      'de',
    );
    expect(temp.map((p) => p.key)).toEqual([
      'app.devices.history.summary.low',
      'app.devices.history.summary.high',
    ]);
  });

  it('has no parts for an empty history', () => {
    expect(summaryOf({ ...historyOf('soil_moisture', '7d'), points: [] }, 25, 'de')).toEqual([]);
  });
});

describe('pointLabel', () => {
  it('spans the hour of an hourly bucket in household time', () => {
    const label = pointLabel('2026-10-23T10:00:00Z', 60, 'de', BERLIN);
    expect(label).toContain('23. Okt.');
    expect(label).toContain('12–13 Uhr');
  });

  it('closes the last hour of the day with 24 Uhr', () => {
    const label = pointLabel('2026-10-23T21:00:00Z', 60, 'de', BERLIN);
    expect(label).toContain('23. Okt.');
    expect(label).toMatch(/23 Uhr.24 Uhr/);
    expect(label).not.toContain('24.10.');
  });

  it('spans a quarter of an hour', () => {
    expect(pointLabel('2026-10-23T12:15:00Z', 15, 'de', BERLIN)).toContain('14:15–14:30');
  });

  it('names the day only for a daily value', () => {
    const label = pointLabel('2026-10-05T12:00:00Z', 1440, 'de', BERLIN);
    expect(label).toContain('5. Okt.');
    expect(label).not.toContain('Uhr');
  });
});

describe('withUnit', () => {
  it('keeps the unit on the line of its number', () => {
    expect(withUnit(41.26, '%', 'de')).toBe(`41,3${NBSP}%`);
    expect(withUnit(3, null, 'de')).toBe('3');
  });
});

describe('tableRowsOf', () => {
  it('lists hourly values newest first', () => {
    const history = historyOf('soil_moisture', '7d');
    const rows = tableRowsOf(history, 25, [], 'de', BERLIN);
    expect(rows).toHaveLength(168);
    expect(rows[0]!.key).toBe(history.points.at(-1)!.t);
    expect(rows[0]!.value).toBe(withUnit(history.points.at(-1)!.avg, '%', 'de'));
    expect(rows[0]!.notes).toEqual([]);
  });

  it('lists 4 weeks per day with the range, flags too dry days and waterings', () => {
    const history = historyOf('soil_moisture', '28d', (i) => (i < 24 ? 20 : 40));
    const rows = tableRowsOf(history, 25, [history.points[30]!.t], 'de', BERLIN);
    expect(rows).toHaveLength(28);
    expect(rows[0]!.key).toBe(history.days.at(-1)!.date);
    const oldest = rows.at(-1)!;
    expect(oldest.value).toContain('19');
    expect(oldest.notes).toEqual(['dry']);
    const watered = rows.find((r) => r.key === history.days[1]!.date)!;
    expect(watered.notes).toEqual(['watered']);
  });

  it('flags nothing dry without a threshold', () => {
    const history = historyOf('soil_moisture', '28d', () => 5);
    const rows = tableRowsOf(history, null, [], 'de', BERLIN);
    expect(rows.every((r) => r.notes.length === 0)).toBe(true);
  });
});
