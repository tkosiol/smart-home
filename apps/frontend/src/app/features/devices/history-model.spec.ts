import { capability, device, historyOf, moisture, temperature, battery } from './devices-testing';
import {
  chartViewOf,
  historyCapabilities,
  lastLabel,
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
  it('draws soil moisture as an area from 0 to 100 with the threshold and the waterings', () => {
    const history = historyOf('soil_moisture', '7d', (i) => (i < 100 ? 20 : i === 100 ? 45 : 40));
    const view = chartViewOf(history, 25);
    expect(view.kind).toBe('area');
    expect(view.domain).toEqual({ min: 0, max: 100 });
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

  it('names today and yesterday as such, seen from now in household time', () => {
    const now = Date.parse('2026-10-14T12:00:00Z'); // 14:00 in Berlin
    expect(pointLabel('2026-10-14T11:00:00Z', 60, 'de', BERLIN, now)).toBe('Heute, 13–14 Uhr');
    // The first hour of a day starts at 0, not 24 (only a bucket's end at midnight reads 24).
    expect(pointLabel('2026-10-13T22:00:00Z', 60, 'de', BERLIN, now)).toMatch(
      /^Heute, 0?0–0?1 Uhr$/,
    );
    expect(pointLabel('2026-10-13T21:00:00Z', 60, 'de', BERLIN, now)).toMatch(
      /^Gestern, 23 Uhr.24 Uhr$/,
    );
    expect(pointLabel('2026-10-12T21:00:00Z', 60, 'de', BERLIN, now)).toMatch(/^Mo\., 12\. Okt\./);
    expect(pointLabel('2026-10-14T11:00:00Z', 60, 'en', BERLIN, now)).toMatch(/^Today, /);
    expect(pointLabel('2026-10-13T10:00:00Z', 1440, 'en', BERLIN, now)).toBe('Yesterday');
    // Without `now` every day is dated.
    expect(pointLabel('2026-10-14T11:00:00Z', 60, 'de', BERLIN)).toMatch(/^Mi\., 14\. Okt\./);
  });

  it('keeps the minutes of a bucket in a half-hour zone (Asia/Kolkata)', () => {
    // 10:00Z is 15:30 in Kolkata
    expect(pointLabel('2026-10-23T10:00:00Z', 60, 'de', 'Asia/Kolkata')).toContain('15:30–16:30');
    expect(pointLabel('2026-10-23T10:00:00Z', 60, 'en', 'Asia/Kolkata')).toMatch(
      /3:30.{0,3}4:30\s?PM/,
    );
  });

  it('keeps the minutes of a bucket in a 45 minute zone, also across midnight (Pacific/Chatham)', () => {
    // 07:00Z is 20:45 in Chatham (+13:45); 10:00Z is 23:45, its bucket ends at 00:45
    expect(pointLabel('2026-10-23T07:00:00Z', 60, 'de', 'Pacific/Chatham')).toContain(
      '20:45–21:45',
    );
    expect(pointLabel('2026-10-23T10:00:00Z', 60, 'de', 'Pacific/Chatham')).toContain(
      '23:45–00:45',
    );
  });

  it('keeps hours only in whole-hour zones', () => {
    expect(pointLabel('2026-10-23T10:00:00Z', 60, 'de', BERLIN)).toContain('12–13 Uhr');
  });

  it('creates each date formatter once per locale, zone and options', () => {
    pointLabel('2026-10-23T10:00:00Z', 60, 'de', BERLIN, Date.parse('2026-10-24T10:00:00Z'));
    const created = vi.spyOn(Intl, 'DateTimeFormat');
    pointLabel('2026-10-23T11:00:00Z', 60, 'de', BERLIN, Date.parse('2026-10-24T10:00:00Z'));
    pointLabel('2026-10-23T21:00:00Z', 60, 'de', BERLIN, Date.parse('2026-10-24T10:00:00Z'));
    expect(created).not.toHaveBeenCalled();
    created.mockRestore();
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
    const rows = tableRowsOf(history, 25, [], 'de', BERLIN, Date.parse(history.to));
    expect(rows).toHaveLength(168);
    expect(rows[0]!.label).toMatch(/^Heute, /);
    expect(rows[24]!.label).toMatch(/^Gestern, /);
    expect(rows[0]!.key).toBe(history.points.at(-1)!.t);
    expect(rows[48]!.label).toMatch(/Okt\., \d{1,2}[–-]\d{1,2} Uhr/);
    expect(rows[0]!.values).toEqual([withUnit(history.points.at(-1)!.avg, '%', 'de')]);
    expect(rows[0]!.notes).toEqual([]);
  });

  it('lists 4 weeks per day with the range, flags too dry days and waterings', () => {
    const history = historyOf('soil_moisture', '28d', (i) => (i < 24 ? 20 : 40));
    const rows = tableRowsOf(history, 25, [history.points[30]!.t], 'de', BERLIN);
    expect(rows).toHaveLength(28);
    expect(rows[0]!.key).toBe(history.days.at(-1)!.date);
    const oldest = rows.at(-1)!;
    expect(oldest.values).toEqual([withUnit(20, '%', 'de'), `19–${withUnit(21, '%', 'de')}`]);
    expect(oldest.notes).toEqual(['dry']);
    const watered = rows.find((r) => r.key === history.days[1]!.date)!;
    expect(watered.notes).toEqual(['watered']);
  });

  it('lists the last value of a battery bucket, as the chart draws it', () => {
    const base = historyOf('battery', '7d', () => 80);
    const history = { ...base, points: base.points.map((p) => ({ ...p, avg: p.last - 3 })) };
    const rows = tableRowsOf(history, null, [], 'de', BERLIN);
    expect(rows[0]!.values).toEqual([withUnit(history.points.at(-1)!.last, '%', 'de')]);
    const soil = tableRowsOf(history, null, [], 'de', BERLIN);
    expect(soil).toHaveLength(168);
    const other = { ...history, capability: 'temperature' };
    expect(tableRowsOf(other, null, [], 'de', BERLIN)[0]!.values).toEqual([
      withUnit(history.points.at(-1)!.avg, '%', 'de'),
    ]);
  });

  it('flags nothing dry without a threshold', () => {
    const history = historyOf('soil_moisture', '28d', () => 5);
    const rows = tableRowsOf(history, null, [], 'de', BERLIN);
    expect(rows.every((r) => r.notes.length === 0)).toBe(true);
  });
});

describe('lastLabel', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  it('names the day and the time of a reading in household time', () => {
    expect(lastLabel('2026-10-21T12:00:00Z', 'de', BERLIN, now)).toMatch(
      /^Mi\., 21\. Okt\., 14:00$/,
    );
    expect(lastLabel('2026-10-24T09:00:00Z', 'de', BERLIN, now)).toBe('Heute, 11:00');
    expect(lastLabel('2026-10-23T09:00:00Z', 'en', BERLIN, now)).toMatch(/^Yesterday, 11:00/);
  });
});
