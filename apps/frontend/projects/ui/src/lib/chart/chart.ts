import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import { TRANSLOCO_SCOPE, TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { EXPANDED } from '../adaptive-shell/adaptive-shell';
import { mediaQuerySignal } from '../theme/media-queries';
import { ThemeService } from '../theme/theme.service';
import { UiFormatContext } from '../time/format-context';
import type { UiChartRange } from './chart-axis';
import { readChartColors, type ChartColors } from './chart-colors';
import {
  buildChartModel,
  nearestPointIndex,
  type UiChartBand,
  type UiChartKind,
  type UiChartPoint,
} from './chart-options';
import { ECHARTS_LOADER, type ChartHandle } from './echarts-loader';

export type { UiChartBand, UiChartKind, UiChartPoint } from './chart-options';
export type { UiChartRange } from './chart-axis';

let nextId = 0;

interface AxisPointerEvent {
  readonly axesInfo?: readonly { readonly value: number }[];
}

/**
 * Line chart for a device's history (spec 4.1) on Apache ECharts, loaded on first use after the
 * first render (SVG renderer, no animation). Colours are the theme's roles read from the CSS
 * custom properties and re-read when the theme changes. Pointing or swiping sets a vertical
 * guide and reports the point through `scrubbed` (its index in `points`; `null` once the pointer
 * leaves); with focus on the chart ← → move by one point, Home/End jump to the first/last, Esc
 * ends. The element is a `group` named by `label`; `description` is its text alternative.
 * The height is `--smart-size-chart`, `--smart-size-chart-large` from the Expanded window class.
 */
@Component({
  selector: 'ui-chart',
  imports: [TranslocoPipe],
  templateUrl: './chart.html',
  styleUrl: './chart.scss',
  // Own texts (`ui.*`) only; a page's lazy Transloco scope must not prefix them.
  providers: [{ provide: TRANSLOCO_SCOPE, useValue: null }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'group',
    tabindex: '0',
    '[attr.data-large]': "large() ? '' : null",
    '[attr.aria-roledescription]': 'roleDescription()',
    '[attr.aria-label]': 'label()',
    '[attr.aria-describedby]': 'descriptionId',
    '(keydown)': 'onKeydown($event)',
    '(blur)': 'clear()',
    '(pointerleave)': 'clear()',
    '(pointercancel)': 'clear()',
  },
})
export class UiChart {
  readonly points = input.required<readonly UiChartPoint[]>();
  readonly kind = input<UiChartKind>('area');
  readonly range = input.required<UiChartRange>();
  /** Resolution of the points in minutes: a gap of more than twice that breaks the line. */
  readonly resolutionMinutes = input.required<number>();
  readonly timeZone = input.required<string>();
  readonly unit = input<string | null>(null);
  readonly domain = input<{ min: number; max: number } | null>(null);
  readonly band = input<UiChartBand | null>(null);
  /** ISO instants drawn as hollow rings on the first point at or after them. */
  readonly markers = input<readonly string[]>([]);
  readonly label = input.required<string>();
  readonly description = input.required<string>();
  /** The chosen point (index in `points`), `null` when the pointer or keyboard leaves. */
  readonly scrubbed = output<number | null>();

  protected readonly descriptionId = `ui-chart-description-${nextId++}`;
  protected readonly isEmpty = computed(() => this.points().length === 0);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly canvas = viewChild.required<ElementRef<HTMLElement>>('canvas');
  private readonly theme = inject(ThemeService);
  private readonly format = inject(UiFormatContext);
  private readonly loadEngine = inject(ECHARTS_LOADER);
  private readonly roleText = toSignal(
    inject(TranslocoService).selectTranslate(marker('ui.chart.roleDescription')),
    { initialValue: '' },
  );
  protected readonly roleDescription = computed(() => this.roleText() || null);

  protected readonly large = mediaQuerySignal(EXPANDED);

  private readonly chart = signal<ChartHandle | null>(null);
  private readonly colors = signal<ChartColors | null>(null);
  private readonly width = signal(0);
  private current: number | null = null;
  private destroyed = false;
  private frame = 0;

  private readonly model = computed(() => {
    const colors = this.colors();
    const points = this.points();
    if (!colors || !points.length) return null;
    return buildChartModel({
      points,
      kind: this.kind(),
      range: this.range(),
      resolutionMinutes: this.resolutionMinutes(),
      timeZone: this.timeZone(),
      unit: this.unit(),
      domain: this.domain(),
      band: this.band(),
      markers: this.markers(),
      colors,
      locale: this.format.locale(),
      width: this.width(),
    });
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      cancelAnimationFrame(this.frame);
      this.chart()?.dispose();
    });

    // The theme's CSS variables are applied after `resolved` changes (and once the colour engine
    // is loaded), so the roles are read a frame later.
    effect(() => {
      const mode = this.theme.resolved().mode;
      untracked(() => this.readColors(mode === 'dark'));
    });

    effect(() => {
      const chart = this.chart();
      const model = this.model();
      if (!chart) return;
      chart.setOption(model ? model.option : { series: [] }, { notMerge: true });
      // A redraw drops the guide: tell the consumer, whose readout would otherwise go stale.
      if (this.current !== null) {
        this.current = null;
        untracked(() => this.scrubbed.emit(null));
      }
    });

    afterNextRender(() => {
      const element = this.canvas().nativeElement;
      this.width.set(element.clientWidth);
      const observer =
        typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(() => {
              this.width.set(element.clientWidth);
              this.chart()?.resize();
            });
      observer?.observe(element);
      destroyRef.onDestroy(() => observer?.disconnect());
      void this.theme.ready.then(() => this.readColors(this.theme.resolved().mode === 'dark'));
      void this.start(element);
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.points().length;
    if (!count) return;
    if (event.key === 'Escape') {
      this.clear();
      return;
    }
    const current = this.current ?? count - 1;
    const next =
      event.key === 'ArrowLeft'
        ? current - 1
        : event.key === 'ArrowRight'
          ? current + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    this.select(Math.max(0, Math.min(count - 1, next)));
  }

  protected clear(): void {
    if (this.current === null) return;
    this.current = null;
    this.chart()?.dispatchAction({ type: 'hideTip' });
    this.scrubbed.emit(null);
  }

  private select(index: number): void {
    this.current = index;
    const row = this.model()?.rows[index];
    if (row !== undefined) {
      this.chart()?.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: row });
    }
    this.scrubbed.emit(index);
  }

  private readColors(dark: boolean): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.colors.set(readChartColors(this.host, dark)));
  }

  private async start(element: HTMLElement): Promise<void> {
    let chart: ChartHandle;
    try {
      chart = (await this.loadEngine()).init(element);
    } catch (error) {
      console.warn('The chart library could not be loaded', error);
      return;
    }
    if (this.destroyed) {
      chart.dispose();
      return;
    }
    chart.on('updateAxisPointer', ((event: AxisPointerEvent) => {
      const value = event.axesInfo?.[0]?.value;
      const model = this.model();
      if (value === undefined || !model) return;
      const index = nearestPointIndex(model.times, value);
      if (index < 0 || index === this.current) return;
      this.current = index;
      this.scrubbed.emit(index);
    }) as (event: never) => void);
    chart.on('globalout', () => this.clear());
    this.chart.set(chart);
  }
}
