import { chartAxisLabels } from './chart-axis';
import type { ChartColors } from './chart-colors';
import { withAlpha } from './chart-colors';
import {
  buildChartModel,
  chartTicks,
  nearestPointIndex,
  type ChartModelInput,
  type ChartOption,
} from './chart-options';

const COLORS: ChartColors = {
  primary: '#00687a',
  outline: '#70797b',
  outlineVariant: '#bfc8cb',
  onSurfaceVariant: '#3f484b',
  card: '#eff4f7',
  dry: '#795900',
  dryContainer: '#ffdfa0',
  fontFamily: 'Roboto Flex',
  dark: false,
};

const HOUR = 3_600_000;
const END = Date.parse('2026-10-27T12:00:00.000Z');
const at = (hoursAgo: number) => new Date(END - hoursAgo * HOUR).toISOString();

function input(overrides: Partial<ChartModelInput> = {}): ChartModelInput {
  const points = [
    { t: at(3), value: 30 },
    { t: at(2), value: 28 },
    { t: at(1), value: 20 },
    { t: at(0), value: 24 },
  ];
  return {
    points,
    kind: 'area',
    range: '24h',
    resolutionMinutes: 60,
    timeZone: 'Europe/Berlin',
    unit: '%',
    domain: null,
    band: null,
    markers: [],
    colors: COLORS,
    locale: 'de',
    width: 636,
    ...overrides,
  };
}

// The option is a plain object tree; the tests look at it loosely.
/* eslint-disable @typescript-eslint/no-explicit-any */
const series = (option: ChartOption): any[] => option['series'] as any[];

describe('buildChartModel', () => {
  it('turns points into [time, value] pairs with animation off', () => {
    const { option, times } = buildChartModel(input());
    expect(option['animation']).toBe(false);
    expect(times).toEqual([END - 3 * HOUR, END - 2 * HOUR, END - HOUR, END]);
    expect(series(option)[0].data).toEqual([
      [END - 3 * HOUR, 30],
      [END - 2 * HOUR, 28],
      [END - HOUR, 20],
      [END, 24],
    ]);
  });

  it('smooths an area monotonically and fills it with a fade', () => {
    const main = series(buildChartModel(input()).option)[0];
    expect(main.smooth).toBe(true);
    expect(main.smoothMonotone).toBe('x');
    expect(main.areaStyle.color.colorStops[0].color).toBe(withAlpha(COLORS.primary, 0.2));
    expect(main.areaStyle.color.colorStops[1].color).toBe(withAlpha(COLORS.primary, 0));
    expect(main.lineStyle.width).toBe(2);
  });

  it('uses the stronger washes and hairlines in dark mode', () => {
    const band = { below: 25, label: 'too dry', valueLabel: '25 %' };
    const dark = series(
      buildChartModel(
        input({ colors: { ...COLORS, dark: true }, domain: { min: 0, max: 80 }, band }),
      ).option,
    )[0];
    expect(dark.areaStyle.color.colorStops[0].color).toBe(withAlpha(COLORS.primary, 0.26));
    expect(dark.markArea.itemStyle.color).toBe(withAlpha(COLORS.dryContainer, 0.5));
    const [threshold, gridline] = dark.markLine.data;
    expect(threshold.lineStyle.color).toBe(withAlpha(COLORS.dry, 0.6));
    expect(gridline.lineStyle.color).toBe(withAlpha(COLORS.outlineVariant, 0.7));
  });

  it('paints the band, then the hairlines and labels, then the line, then the dots', () => {
    const band = { below: 25, label: 'too dry', valueLabel: '25 %' };
    const main = series(buildChartModel(input({ domain: { min: 0, max: 80 }, band })).option)[0];
    expect(main.markArea.z).toBeLessThan(main.markLine.z);
    expect(main.markLine.z).toBeLessThan(main.z);
    expect(main.z).toBeLessThan(main.markPoint.z);
  });

  it('draws a step as a step line without smoothing', () => {
    const main = series(buildChartModel(input({ kind: 'step' })).option)[0];
    expect(main.step).toBe('end');
    expect(main.smooth).toBeFalsy();
  });

  it('draws a ribbon as two stacked series under the line', () => {
    const model = buildChartModel(
      input({
        kind: 'ribbon',
        points: [
          { t: at(2), value: 20, min: 18, max: 22 },
          { t: at(1), value: 21, min: 19, max: 24 },
          { t: at(0), value: 22, min: 20, max: 23 },
        ],
      }),
    );
    const [main, base, range] = series(model.option);
    expect(main.data.map((d: number[]) => d[1])).toEqual([20, 21, 22]);
    expect(base.stack).toBe(range.stack);
    expect(base.data.map((d: number[]) => d[1])).toEqual([18, 19, 20]);
    expect(range.data.map((d: number[]) => d[1])).toEqual([4, 5, 3]);
    expect(range.areaStyle.color).toBe(withAlpha(COLORS.primary, 0.16));
    expect(base.areaStyle.color).toBe('transparent');
    expect(main.areaStyle).toBeUndefined();
  });

  it('breaks the line where the gap exceeds twice the resolution', () => {
    const model = buildChartModel(
      input({
        resolutionMinutes: 60,
        points: [
          { t: at(6), value: 30 },
          { t: at(5), value: 29 },
          { t: at(2), value: 20 }, // 3 h later: gap
          { t: at(1), value: 21 },
          { t: at(0), value: 22 }, // exactly the resolution: no gap
        ],
      }),
    );
    const data = series(model.option)[0].data as [number, number | null][];
    expect(data).toHaveLength(6);
    expect(data[2]![1]).toBeNull();
    expect(data[2]![0]).toBeGreaterThan(END - 5 * HOUR);
    expect(data[2]![0]).toBeLessThan(END - 2 * HOUR);
    expect(series(model.option)[0].connectNulls).toBe(false);
    // point index -> data row skips the filler
    expect(model.rows).toEqual([0, 1, 3, 4, 5]);
    expect(model.times).toHaveLength(5);
  });

  it('draws a point with a gap on both sides (or at an edge) as a small dot', () => {
    const band = { below: 25, label: 'too dry', valueLabel: '25 %' };
    const model = buildChartModel(
      input({
        band,
        domain: { min: 0, max: 80 },
        points: [
          { t: at(10), value: 30 }, // alone: gap after it
          { t: at(6), value: 20 },
          { t: at(5), value: 21 },
          { t: at(4), value: 22 }, // part of a line
          { t: at(1), value: 40 }, // alone between two gaps
        ],
      }),
    );
    const dots = series(model.option)[1];
    expect(dots.type).toBe('scatter');
    expect(dots.silent).toBe(true);
    expect(dots.symbolSize).toBe(6);
    expect(dots.z).toBeGreaterThan(series(model.option)[0].z);
    expect(dots.data.map((d: any) => d.value)).toEqual([
      [END - 10 * HOUR, 30],
      [END - HOUR, 40],
    ]);
    expect(dots.data[0].itemStyle.color).toBe(COLORS.primary);
    const dry = buildChartModel(
      input({
        band,
        points: [
          { t: at(10), value: 10 },
          { t: at(1), value: 40 },
        ],
      }),
    );
    expect(series(dry.option)[1].data[0].itemStyle.color).toBe(COLORS.dry);
  });

  it('adds no dots when every point has a neighbour', () => {
    expect(series(buildChartModel(input()).option)).toHaveLength(1);
  });

  it('never breaks a step line: a value holds until it changes', () => {
    const model = buildChartModel(
      input({
        kind: 'step',
        points: [
          { t: at(40), value: 90 },
          { t: at(10), value: 80 },
          { t: at(0), value: 70 },
        ],
      }),
    );
    expect(series(model.option)[0].data).toHaveLength(3);
    expect(model.rows).toEqual([0, 1, 2]);
    expect(series(model.option)).toHaveLength(1);
  });

  it('does not break at exactly twice the resolution', () => {
    const model = buildChartModel(
      input({
        points: [
          { t: at(2), value: 1 },
          { t: at(0), value: 2 },
        ],
      }),
    );
    expect(series(model.option)[0].data).toHaveLength(2);
  });

  it('recolours the part below the band threshold through a piecewise visual map', () => {
    const band = { below: 25, label: 'too dry', valueLabel: '25 %' };
    const { option } = buildChartModel(input({ band }));
    const map = (option['visualMap'] as any[])[0];
    expect(map.type).toBe('piecewise');
    expect(map.dimension).toBe(1);
    expect(map.pieces).toEqual([
      { lt: 25, color: COLORS.dry },
      { gte: 25, lt: 1e9, color: COLORS.primary },
    ]);
  });

  it('paints the band from the bottom to the threshold with its label and a threshold line', () => {
    const band = { below: 25, label: 'too dry', valueLabel: '25 %' };
    const main = series(buildChartModel(input({ domain: { min: 0, max: 80 }, band })).option)[0];
    const [[from, to]] = main.markArea.data;
    expect(from.yAxis).toBe(0);
    expect(to.yAxis).toBe(25);
    expect(from.label.formatter).toBe('too dry');
    // 8 px in, baseline 15 px below the threshold: ECharts takes one distance for both axes
    expect(from.label.distance).toBe(8);
    expect(from.label.offset).toEqual([0, -3]);
    expect(main.markArea.itemStyle.color).toBe(withAlpha(COLORS.dryContainer, 0.42));
    const threshold = main.markLine.data.find((d: any) => d.yAxis === 25);
    expect(threshold.label.formatter).toBe('25 %');
    expect(threshold.lineStyle.color).toBe(withAlpha(COLORS.dry, 0.55));
  });

  it('has no band, visual map or mark area without a band', () => {
    const { option } = buildChartModel(input());
    expect(option['visualMap']).toBeUndefined();
    expect(series(option)[0].markArea).toBeUndefined();
  });

  it('labels the gridlines inside above their line, with the unit', () => {
    const main = series(
      buildChartModel(input({ domain: { min: 0, max: 80 }, unit: '%' })).option,
    )[0];
    const labels = main.markLine.data.map((d: any) => d.label.formatter);
    expect(labels).toEqual(['20 %', '40 %', '60 %', '80 %']);
    expect(main.markLine.data[0].label.position).toBe('insideStartTop');
    expect(main.markLine.data[0].label.distance).toEqual([8, 3]);
    expect(main.markLine.silent).toBe(true);
    expect(main.markLine.data[0].label.textBorderColor).toBe(COLORS.card);
    expect(main.markLine.data[0].label.textBorderWidth).toBe(3);
  });

  it('uses the band threshold as the step when it fits the domain', () => {
    const band = { below: 25, label: 'too dry', valueLabel: '25 %' };
    const main = series(buildChartModel(input({ domain: { min: 0, max: 80 }, band })).option)[0];
    expect(main.markLine.data.map((d: any) => d.yAxis)).toEqual([25, 50, 75]);
  });

  it('puts the "now" dot on the last point and rings on the markers', () => {
    const model = buildChartModel(input({ markers: [at(2), at(1.5), '2020-01-01T00:00:00.000Z'] }));
    const data = series(model.option)[0].markPoint.data;
    // markers: first point at or after the marker time (the one at 1 h ago), none for 2020
    const rings = data.filter((d: any) => d.name === 'marker');
    expect(rings.map((d: any) => d.coord)).toEqual([
      [END - 2 * HOUR, 28],
      [END - HOUR, 20],
    ]);
    const now = data.find((d: any) => d.name === 'now');
    expect(now.coord).toEqual([END, 24]);
    expect(rings[0].itemStyle.color).toBe(COLORS.card);
    expect(rings[0].itemStyle.borderColor).toBe(COLORS.primary);
    expect(now.itemStyle.color).toBe(COLORS.primary);
    expect(now.itemStyle.borderColor).toBe(COLORS.card);
    // the design: "now" is a 4 px disc in a 6 px ring, a watering ring 3.5 in 5.5 (2 px edges)
    expect([now.symbolSize, now.itemStyle.borderWidth]).toEqual([10, 2]);
    expect([rings[0].symbolSize, rings[0].itemStyle.borderWidth]).toEqual([9, 2]);
  });

  it('spans the window from `from` to `to` instead of ending at the last point', () => {
    const to = new Date(END + 3 * HOUR).toISOString();
    const from = new Date(END + 3 * HOUR - 7 * 24 * HOUR).toISOString();
    const model = buildChartModel(input({ range: '7d', from, to }));
    const axis = model.option['xAxis'] as any;
    expect(axis.min).toBe(Date.parse(from));
    expect(axis.max).toBe(Date.parse(to));
    // the last day's label is "Heute", centred on the part of that day inside the window (axis ends at `to`)
    const texts = axis.axisLabel.customValues.map(axis.axisLabel.formatter);
    expect(texts.at(-1)).toBe('Heute');
    expect(axis.axisLabel.customValues.at(-1)).toBeLessThanOrEqual(Date.parse(to));
  });

  it('draws the "now" dot only when the last point is within twice the resolution of `to`', () => {
    const marks = (m: ReturnType<typeof buildChartModel>) =>
      series(m.option)[0].markPoint.data.map((d: any) => d.name);
    const range = { range: '7d' as const, resolutionMinutes: 60 };
    const fresh = new Date(END + 2 * HOUR).toISOString();
    expect(marks(buildChartModel(input({ ...range, to: fresh })))).toContain('now');
    const stale = new Date(END + 3 * 24 * HOUR).toISOString();
    expect(marks(buildChartModel(input({ ...range, to: stale })))).not.toContain('now');
    expect(marks(buildChartModel(input({ ...range })))).toContain('now');
  });

  it('shows the hovered point as a primary 5 px disc in a 7 px card ring, even below the band', () => {
    const band = { below: 25, label: 'too dry', valueLabel: '25 %' };
    const main = series(buildChartModel(input({ domain: { min: 0, max: 80 }, band })).option)[0];
    expect(main.showSymbol).toBe(false);
    expect(main.symbolSize).toBe(12);
    expect(main.emphasis.scale).toBe(1);
    expect(main.emphasis.itemStyle).toEqual({
      color: COLORS.primary,
      borderColor: COLORS.card,
      borderWidth: 2,
    });
  });

  it('shows no axis pointer content and snaps the line to the points', () => {
    const tooltip = buildChartModel(input()).option['tooltip'] as any;
    expect(tooltip.trigger).toBe('axis');
    expect(tooltip.showContent).toBe(false);
    expect(tooltip.axisPointer.snap).toBe(true);
    expect(tooltip.axisPointer.lineStyle.color).toBe(withAlpha(COLORS.outline, 0.7));
  });

  it('labels the time axis with the household-zone labels', () => {
    const model = buildChartModel(input());
    const axis = model.option['xAxis'] as any;
    const labels = chartAxisLabels(
      '24h',
      new Date(END - 24 * HOUR).toISOString(),
      new Date(END).toISOString(),
      'Europe/Berlin',
      false,
      'de',
    );
    expect(axis.type).toBe('time');
    expect(axis.axisLabel.customValues).toEqual(labels.map((l) => Date.parse(l.t)));
    expect(axis.axisLabel.formatter(Date.parse(labels[0]!.t))).toBe(labels[0]!.text);
    expect(axis.axisLine.show).toBe(false);
    expect(axis.axisTick.show).toBe(false);
    expect(axis.axisLabel.margin).toBe(10);
    expect(axis.max).toBe(END);
    expect(axis.min).toBe(END - 24 * HOUR);
    // "18 Uhr" 5 h after the start and "12 Uhr" 1 h before the end both fit centred
    expect(axis.axisLabel.alignMinLabel).toBe('center');
    expect(axis.axisLabel.alignMaxLabel).toBe('center');
    // before the first measurement (width 0) the end labels hug their instants
    const unmeasured = buildChartModel(input({ width: 0 })).option['xAxis'] as any;
    expect(unmeasured.axisLabel.alignMinLabel).toBe('left');
    expect(unmeasured.axisLabel.alignMaxLabel).toBe('right');
  });

  it('ends "Today" at the right edge, centres the weekday of a full day, thins out when narrow', () => {
    const week = Array.from({ length: 7 * 24 }, (_, i) => ({ t: at(7 * 24 - 1 - i), value: 30 }));
    const wide = buildChartModel(input({ points: week, range: '7d', width: 636 }));
    const wideAxis = wide.option['xAxis'] as any;
    const wideTexts = wideAxis.axisLabel.customValues.map(wideAxis.axisLabel.formatter);
    // "Heute" is centred on the day's first 13 h: 32 px of text end before the right edge
    expect(wideTexts.at(-1)).toBe('Heute');
    expect(wideAxis.axisLabel.alignMaxLabel).toBe('center');
    expect(wideAxis.axisLabel.alignMinLabel).toBe('center');

    const narrow = buildChartModel(input({ points: week, range: '7d', width: 256 }));
    const narrowAxis = narrow.option['xAxis'] as any;
    expect(narrowAxis.axisLabel.customValues.map(narrowAxis.axisLabel.formatter)).not.toContain(
      'Heute',
    );

    const month = Array.from({ length: 28 }, (_, i) => ({ t: at((27 - i) * 24), value: 30 }));
    const axis = buildChartModel(input({ points: month, range: '28d', width: 636 })).option[
      'xAxis'
    ] as any;
    expect(axis.axisLabel.formatter(END)).toBe('Heute');
    expect(axis.axisLabel.alignMaxLabel).toBe('right');
  });

  it('fixes the value axis to the given domain, otherwise to a rounded range with air', () => {
    expect(
      (buildChartModel(input({ domain: { min: 0, max: 80 } })).option['yAxis'] as any).max,
    ).toBe(80);
    const auto = buildChartModel(input()).option['yAxis'] as any;
    expect(auto.min).toBeLessThanOrEqual(20);
    expect(auto.max).toBeGreaterThanOrEqual(30);
    expect(auto.show).toBe(false);
  });

  it('builds a model for a single point and for none', () => {
    const lone = series(buildChartModel(input({ points: [{ t: at(0), value: 5 }] })).option);
    expect(lone).toHaveLength(2);
    expect(lone[1].data.map((d: any) => d.value)).toEqual([[END, 5]]);
    expect(buildChartModel(input({ points: [] })).times).toEqual([]);
  });
});

describe('chartTicks', () => {
  it('rounds the range outward and keeps the line away from the edges', () => {
    const { domain, ticks } = chartTicks([20.2, 23.4], null, null);
    expect(domain.min).toBeLessThan(20.2);
    expect(domain.max).toBeGreaterThan(23.4);
    expect(ticks.every((t) => t > domain.min && t <= domain.max)).toBe(true);
  });
});

describe('nearestPointIndex', () => {
  const times = [10, 20, 40];
  it('picks the nearest point', () => {
    expect(nearestPointIndex(times, 12)).toBe(0);
    expect(nearestPointIndex(times, 17)).toBe(1);
    expect(nearestPointIndex(times, 31)).toBe(2);
    expect(nearestPointIndex(times, 1000)).toBe(2);
    expect(nearestPointIndex(times, -5)).toBe(0);
  });
  it('returns -1 without points', () => {
    expect(nearestPointIndex([], 1)).toBe(-1);
  });
});
