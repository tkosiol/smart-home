import { chartAxisLabels, rangeDurationMs, type UiChartRange } from './chart-axis';
import { chartAlphas, withAlpha, type ChartColors } from './chart-colors';

export type UiChartKind = 'area' | 'ribbon' | 'step';

export interface UiChartPoint {
  readonly t: string;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
}

export interface UiChartBand {
  readonly below: number;
  readonly label: string;
  readonly valueLabel: string;
}

/** An ECharts option: a plain object tree, built here without importing ECharts. */
export type ChartOption = Record<string, unknown>;

export interface ChartModelInput {
  readonly points: readonly UiChartPoint[];
  readonly kind: UiChartKind;
  readonly range: UiChartRange;
  readonly resolutionMinutes: number;
  readonly timeZone: string;
  readonly unit: string | null;
  readonly domain: { readonly min: number; readonly max: number } | null;
  readonly band: UiChartBand | null;
  readonly markers: readonly string[];
  readonly colors: ChartColors;
  readonly locale: string;
  readonly narrow: boolean;
}

export interface ChartModel {
  readonly option: ChartOption;
  /** Instant (ms) of each point. */
  readonly times: readonly number[];
  /** Row of each point in the series data (rows between them are the gap fillers). */
  readonly rows: readonly number[];
}

const NBSP = ' ';
const STEPS = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
const LABEL_SIZE = 12;
const GRID = { left: 6, right: 10, top: 22, bottom: 26 };

/**
 * The value range and the gridline values. Without `domain` the range is rounded outward to a
 * step with air above and below; a `threshold` that is itself a good step is used as the step
 * (25, 50, 75 for a band at 25), otherwise it joins the lines and pushes close neighbours away.
 */
export function chartTicks(
  values: readonly number[],
  domain: { readonly min: number; readonly max: number } | null,
  threshold: number | null,
): { domain: { min: number; max: number }; ticks: number[] } {
  const finite = values.filter(Number.isFinite);
  let lo: number;
  let hi: number;
  let step: number;
  if (domain) {
    lo = domain.min;
    hi = domain.max;
    const span = hi - lo;
    const useThreshold = threshold !== null && threshold > lo && span / threshold <= 4;
    step = useThreshold ? threshold : (STEPS.find((s) => span / s <= 4) ?? span);
  } else {
    const min = finite.length ? Math.min(...finite) : 0;
    const max = finite.length ? Math.max(...finite) : 1;
    const span = Math.max(max - min, 0.5);
    step = STEPS.find((s) => span / s <= 4) ?? span;
    lo = Math.floor(min / step) * step;
    hi = Math.ceil(max / step) * step;
    if (hi === lo) hi = lo + step;
    if ((max - lo) / (hi - lo) > 0.9) hi += step;
    if ((min - lo) / (hi - lo) < 0.1) lo -= step;
  }
  const span = hi - lo;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    const value = +v.toFixed(4);
    if (value > lo + 1e-9) ticks.push(value);
  }
  if (threshold !== null && threshold > lo && threshold <= hi) {
    const clear = ticks.filter((v) => v === threshold || Math.abs(v - threshold) >= span * 0.1);
    if (!clear.includes(threshold)) clear.push(threshold);
    clear.sort((a, b) => a - b);
    return { domain: { min: lo, max: hi }, ticks: clear };
  }
  return { domain: { min: lo, max: hi }, ticks };
}

/** Index of the point nearest to `value` (a time), -1 without points. `times` ascending. */
export function nearestPointIndex(times: readonly number[], value: number): number {
  if (!times.length) return -1;
  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (times[mid]! < value) low = mid + 1;
    else high = mid;
  }
  if (low > 0 && value - times[low - 1]! <= times[low]! - value) low--;
  return low;
}

type Row = [number, number | null];

export function buildChartModel(input: ChartModelInput): ChartModel {
  const { points, kind, colors, band } = input;
  const alpha = chartAlphas(colors.dark);
  const times = points.map((point) => Date.parse(point.t));
  const maxGap = input.resolutionMinutes * 2 * 60_000;

  // One row per point; a null row between two points that are too far apart breaks the line.
  const rows: number[] = [];
  const pointOfRow = new Map<number, number>();
  const pick = (value: (point: UiChartPoint) => number): Row[] => {
    const data: Row[] = [];
    points.forEach((point, index) => {
      if (index > 0 && times[index]! - times[index - 1]! > maxGap) {
        data.push([(times[index]! + times[index - 1]!) / 2, null]);
      }
      rows[index] = data.length;
      pointOfRow.set(data.length, index);
      data.push([times[index]!, value(point)]);
    });
    return data;
  };
  const main = pick((point) => point.value);
  const hasLast = points.length > 0;
  const to = hasLast ? times[times.length - 1]! : 0;
  const from = hasLast ? Math.min(to - rangeDurationMs(input.range), times[0]!) : 0;

  const ribbon = kind === 'ribbon';
  const extent = ribbon
    ? points.flatMap((point) => [point.min ?? point.value, point.max ?? point.value])
    : points.map((point) => point.value);
  const { domain, ticks } = chartTicks(extent, input.domain, band?.below ?? null);

  const decimals = ticks.some((v) => !Number.isInteger(v)) ? 1 : 0;
  const numberFormat = new Intl.NumberFormat(input.locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const valueText = (value: number) =>
    numberFormat.format(value) + (input.unit ? NBSP + input.unit : '');

  const text = {
    color: colors.onSurfaceVariant,
    fontFamily: colors.fontFamily,
    fontSize: LABEL_SIZE,
    fontWeight: 500,
  };
  const halo = { textBorderColor: colors.card, textBorderWidth: 3 };

  const lines = ticks.map((value) => {
    const threshold = band !== null && value === band.below;
    return {
      yAxis: value,
      lineStyle: {
        color: withAlpha(
          threshold ? colors.dry : colors.outlineVariant,
          alpha[threshold ? 'threshold' : 'grid'],
        ),
        width: 1,
        type: 'solid',
      },
      label: {
        show: true,
        position: 'insideStartTop',
        distance: [8, 2],
        formatter: threshold ? band.valueLabel : valueText(value),
        ...text,
        ...halo,
      },
    };
  });

  const marks: Record<string, unknown>[] = [];
  const ring = (index: number) => ({
    name: 'marker',
    coord: [times[index]!, points[index]!.value],
    symbol: 'circle',
    symbolSize: 10,
    itemStyle: { color: colors.card, borderColor: colors.primary, borderWidth: 2 },
  });
  const seen = new Set<number>();
  for (const marker of input.markers) {
    const at = Date.parse(marker);
    if (!Number.isFinite(at) || at < from) continue;
    const index = times.findIndex((time) => time >= at);
    if (index < 0 || seen.has(index)) continue;
    seen.add(index);
    marks.push(ring(index));
  }
  if (hasLast) {
    const last = points.length - 1;
    marks.push({
      name: 'now',
      coord: [times[last]!, points[last]!.value],
      symbol: 'circle',
      symbolSize: 12,
      itemStyle: { color: colors.primary, borderColor: colors.card, borderWidth: 2.5 },
    });
  }

  const line: Record<string, unknown> = {
    type: 'line',
    data: main,
    z: 3,
    showSymbol: false,
    symbol: 'circle',
    symbolSize: 10,
    connectNulls: false,
    silent: false,
    // No line colour of its own: the stroke then follows the item colour or the visual map.
    lineStyle: { width: 2, cap: 'round', join: 'round' },
    itemStyle: { color: colors.primary, borderColor: colors.card, borderWidth: 2 },
    emphasis: { scale: 1, lineStyle: { width: 2 } },
    markLine: {
      silent: true,
      symbol: ['none', 'none'],
      animation: false,
      data: lines,
    },
    markPoint: { silent: true, animation: false, label: { show: false }, data: marks },
    ...(kind === 'step' ? { step: 'end' } : { smooth: true, smoothMonotone: 'x' }),
    ...(ribbon
      ? {}
      : {
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: withAlpha(colors.primary, alpha.area) },
                { offset: 1, color: withAlpha(colors.primary, 0) },
              ],
            },
          },
        }),
  };
  if (band) {
    line['markArea'] = {
      silent: true,
      animation: false,
      itemStyle: { color: withAlpha(colors.dryContainer, alpha.band), borderRadius: 4 },
      data: [
        [
          {
            yAxis: domain.min,
            label: {
              show: true,
              position: 'insideTopLeft',
              distance: 8,
              formatter: band.label,
              ...text,
              ...halo,
            },
          },
          { yAxis: band.below },
        ],
      ],
    };
  }

  const series: Record<string, unknown>[] = [line];
  if (ribbon) {
    const bounds = {
      type: 'line',
      stack: 'ribbon',
      showSymbol: false,
      silent: true,
      smooth: true,
      smoothMonotone: 'x',
      connectNulls: false,
      z: 1,
      lineStyle: { width: 0 },
    };
    const lower: Row[] = [];
    const span: Row[] = [];
    main.forEach(([t, value], row) => {
      if (value === null) {
        lower.push([t, null]);
        span.push([t, null]);
        return;
      }
      const point = points[pointOfRow.get(row)!]!;
      const min = point.min ?? point.value;
      lower.push([t, min]);
      span.push([t, (point.max ?? point.value) - min]);
    });
    series.push(
      { ...bounds, data: lower, areaStyle: { color: 'transparent' } },
      { ...bounds, data: span, areaStyle: { color: withAlpha(colors.primary, alpha.ribbon) } },
    );
  }

  const labels = hasLast
    ? chartAxisLabels(
        input.range,
        new Date(from).toISOString(),
        new Date(to).toISOString(),
        input.timeZone,
        input.narrow,
        input.locale,
      )
    : [];
  const labelText = new Map(labels.map((label) => [Date.parse(label.t), label.text]));

  const option: ChartOption = {
    animation: false,
    grid: { ...GRID, containLabel: false },
    xAxis: {
      type: 'time',
      min: from,
      max: to,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisPointer: { snap: true },
      axisLabel: {
        show: true,
        customValues: [...labelText.keys()],
        formatter: (value: number) => labelText.get(value) ?? '',
        hideOverlap: true,
        showMinLabel: true,
        showMaxLabel: true,
        alignMinLabel: 'left',
        alignMaxLabel: 'right',
        margin: 8,
        ...text,
      },
    },
    yAxis: {
      type: 'value',
      show: false,
      min: domain.min,
      max: domain.max,
      splitLine: { show: false },
    },
    tooltip: {
      trigger: 'axis',
      showContent: false,
      axisPointer: {
        type: 'line',
        snap: true,
        lineStyle: { color: withAlpha(colors.outline, alpha.pointer), width: 1, type: 'solid' },
      },
    },
    series,
  };
  if (band) {
    option['visualMap'] = [
      {
        type: 'piecewise',
        show: false,
        dimension: 1,
        seriesIndex: 0,
        pieces: [
          { lt: band.below, color: colors.dry },
          // A bounded upper end: ECharts fails to build the gradient of an open-ended last piece.
          { gte: band.below, lt: 1e9, color: colors.primary },
        ],
      },
    ];
  }
  return { option, times, rows };
}
