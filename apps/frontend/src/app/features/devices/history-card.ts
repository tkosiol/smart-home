import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { filter, scan } from 'rxjs';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import {
  HISTORY_RANGES,
  historySummary,
  type Capability,
  type Device,
  type DeviceHistory,
  type HistoryRange,
} from '@smart/contracts';
import {
  UiButton,
  UiCard,
  UiChart,
  UiClock,
  UiFigure,
  UiFormatContext,
  UiIconButton,
  type UiOption,
  UiRelativeTimePipe,
  UiSkeleton,
  UiStack,
  type UiTableColumn,
  type UiTableRow,
  UiValueDisplay,
  UiValueTable,
} from '@smart/ui';
import { UiChipSet, UiSegmentedButton, type UiChipOption } from '@smart/ui/forms';
import { ApiError } from '../../core/api';
import { HouseholdContext, injectHouseholdErrorHandler } from '../../core/household';
import { injectLive, throttled } from '../../core/live';
import { RefreshGuard } from '../../core/refresh';
import { NO_VALUE } from './device-pod';
import { capabilityLabelKey, formatNumber } from './device-values';
import { DevicesApi } from './devices.api';
import {
  DRY_KEY,
  NOTE_KEYS,
  RANGE_KEYS,
  SPAN_KEYS,
  chartViewOf,
  historyCapabilities,
  lastLabel,
  localDate,
  pointLabel,
  summaryOf,
  tableRowsOf,
  thresholdFor,
  withUnit,
  type TableRow,
} from './history-model';

/** The shortest time between two reloads caused by the device's reports. */
const RELOAD_WINDOW_MS = 60_000;
/**
 * The backend writes buffered readings once a second, and the event goes out when one is buffered:
 * a reload started by an event waits this long so it sees the reading that caused it.
 */
const WRITER_SETTLE_MS = 2_000;
const DEFAULT_RANGE: HistoryRange = '7d';

/** The texts this card composes in code: root keys, marked so the key check finds them. */
const KEYS = {
  now: marker('app.devices.history.now'),
  last: marker('app.devices.history.last'),
  watered: marker('app.devices.history.watered'),
  separator: marker('app.devices.history.separator'),
  empty: marker('app.devices.history.empty'),
  error: marker('app.devices.history.error.text'),
  chartLabel: marker('app.devices.history.chart.label'),
  column: {
    time: marker('app.devices.history.column.time'),
    day: marker('app.devices.history.column.day'),
    mean: marker('app.devices.history.column.mean'),
    span: marker('app.devices.history.column.span'),
  },
} as const;

/** The note of a table row: "zeitweise zu trocken", "gegossen" or both. */
function noteKeyOf(row: TableRow): string {
  return row.notes.length === 2
    ? NOTE_KEYS.both
    : row.notes[0] === 'dry'
      ? NOTE_KEYS.dry
      : NOTE_KEYS.watered;
}

/**
 * The "Verlauf" of a device (spec 4.3): one reading at a time (chips, the main value first) over
 * 24 hours, 7 days or 4 weeks, as a chart or, on request, a table. Above the chart stands the value
 * (the current one, or the one under the pointer with the time it stands for), below it what
 * happened in the period. The history is fetched again when the device reports (at most once a minute); an answer to an older
 * choice of reading or period never replaces the current one.
 */
@Component({
  selector: 'app-history-card',
  imports: [
    TranslocoPipe,
    UiButton,
    UiCard,
    UiChart,
    UiChipSet,
    UiFigure,
    UiIconButton,
    UiSegmentedButton,
    UiSkeleton,
    UiStack,
    UiValueDisplay,
    UiValueTable,
  ],
  providers: [UiRelativeTimePipe],
  template: `
    <ui-card variant="low" [level]="2" [heading]="'devices.history.title' | transloco">
      <ui-icon-button
        uiCardHeaderAction
        variant="tonal"
        icon="table_rows"
        [toggled]="table()"
        [label]="'devices.history.table' | transloco"
        (pressed)="table.set(!table())"
      />
      <ui-stack gap="lg">
        @if (options().length > 1) {
          <ui-chip-set
            [label]="'devices.history.capability' | transloco"
            [options]="options()"
            [multiple]="false"
            [(selected)]="selected"
          />
        }
        <div aria-live="polite">
          <ui-value-display
            size="readout"
            [value]="readout().value"
            [unit]="readout().unit ?? undefined"
            [label]="readoutLine()"
          />
        </div>
        <ui-figure [caption]="caption()" [message]="message()">
          @switch (state()) {
            @case ('loading') {
              <ui-skeleton variant="chart" />
            }
            @case ('failed') {
              <ui-button variant="tonal" (pressed)="retry()">{{
                'devices.history.error.retry' | transloco
              }}</ui-button>
            }
            @default {
              @if (chart(); as chart) {
                @if (table()) {
                  <ui-value-table [columns]="columns()" [rows]="rows()" [label]="chartLabel()" />
                } @else {
                  <ui-chart
                    [points]="chart.points"
                    [kind]="chart.kind"
                    [range]="range()"
                    [resolutionMinutes]="chart.resolutionMinutes"
                    [timeZone]="timeZone()"
                    [unit]="unit()"
                    [domain]="chart.domain"
                    [band]="band()"
                    [markers]="chart.markers"
                    [from]="window().from"
                    [to]="window().to"
                    [label]="chartLabel()"
                    [description]="'devices.history.chart.description' | transloco: chartWords()"
                    (scrubbed)="scrub.set($event)"
                  />
                }
              }
            }
          }
        </ui-figure>
        <ui-segmented-button
          fullWidth
          [label]="'devices.history.range' | transloco"
          [options]="rangeOptions()"
          [value]="range()"
          (valueChange)="chooseRange($event)"
        />
      </ui-stack>
    </ui-card>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryCard {
  readonly device = input.required<Device>();

  private readonly api = inject(DevicesApi);
  private readonly household = inject(HouseholdContext);
  private readonly handleError = injectHouseholdErrorHandler();
  private readonly format = inject(UiFormatContext);
  private readonly transloco = inject(TranslocoService);
  private readonly relativeTime = inject(UiRelativeTimePipe);
  private readonly clock = inject(UiClock);
  private readonly language = toSignal(this.transloco.langChanges$);
  /** Counts the translations loaded so far: a text asked before its scope was in is asked again. */
  private readonly loaded = toSignal(
    this.transloco.events$.pipe(
      filter((event) => event.type === 'translationLoadSuccess'),
      scan((count) => count + 1, 0),
    ),
    { initialValue: 0 },
  );

  protected readonly locale = this.format.locale;
  protected readonly timeZone = this.format.timeZone;

  private readonly capabilities = computed(() => historyCapabilities(this.device()));
  /** The readings to choose from, again when a device update changes them. */
  private readonly capabilityKeys = computed(() =>
    this.capabilities()
      .map((capability) => capability.key)
      .join('|'),
  );
  protected readonly selected = linkedSignal<string, readonly string[]>({
    source: this.capabilityKeys,
    computation: (keys) => (keys ? [keys.split('|')[0]!] : []),
  });
  private readonly capability = computed<Capability | undefined>(() => {
    const key = this.selected()[0];
    return this.capabilities().find((entry) => entry.key === key);
  });
  protected readonly options = computed<UiChipOption<string>[]>(() =>
    this.capabilities().map((capability) => ({
      value: capability.key,
      label: this.text(capabilityLabelKey(capability.key)) ?? capability.key,
    })),
  );

  protected readonly range = signal<HistoryRange>(DEFAULT_RANGE);
  protected readonly rangeOptions = computed<UiOption<HistoryRange>[]>(() =>
    HISTORY_RANGES.map((value) => ({ value, label: this.text(RANGE_KEYS[value]) ?? value })),
  );
  protected readonly table = signal(false);

  private readonly history = signal<DeviceHistory | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'failed'>('loading');
  /** The point under the pointer or the keyboard (index in the chart's points), if any. */
  protected readonly scrub = signal<number | null>(null);

  private readonly deviceId = computed(() => this.device().id);
  private readonly capabilityKey = computed(() => this.capability()?.key);
  protected readonly unit = computed(() => this.capability()?.unit ?? null);
  private readonly threshold = computed(() => {
    const key = this.capabilityKey();
    return key === undefined ? null : thresholdFor(this.device(), key);
  });

  protected readonly chart = computed(() => {
    const history = this.history();
    if (!history || history.points.length === 0) return null;
    return chartViewOf(history, this.threshold(), this.timeZone());
  });
  /** The period the server answered: the chart's time axis ends at its `to`, not at the last point. */
  protected readonly window = computed(() => {
    const history = this.history();
    return { from: history?.from ?? null, to: history?.to ?? null };
  });
  /** The last drawn point when it is older than twice the resolution before the period's end. */
  private readonly staleSince = computed(() => {
    const view = this.chart();
    const history = this.history();
    const last = view?.points.at(-1);
    if (!view || !history || !last) return null;
    const age = Date.parse(history.to) - Date.parse(last.t);
    return age > view.resolutionMinutes * 2 * 60_000 ? last : null;
  });
  protected readonly band = computed(() => {
    const below = this.chart()?.band ?? null;
    if (below === null) return null;
    return {
      below,
      valueLabel: withUnit(below, this.unit(), this.locale()),
    };
  });
  protected readonly summary = computed(() => {
    const history = this.history();
    return history ? summaryOf(history, this.threshold(), this.locale()) : [];
  });
  private readonly waterings = computed(() => {
    const history = this.history();
    return history?.capability === 'soil_moisture'
      ? historySummary(history, this.threshold()).waterings
      : [];
  });
  protected readonly lastWatering = computed(() => this.waterings().at(-1) ?? null);

  /** The value above the chart: the pointer's point, else the device's current value. */
  protected readonly readout = computed(() => {
    const view = this.chart();
    const point = view && this.scrub() !== null ? view.points[this.scrub()!] : undefined;
    const locale = this.locale();
    if (view && point) {
      const threshold = this.threshold();
      return {
        value: formatNumber(point.value, locale),
        unit: this.unit(),
        label: pointLabel(
          point.t,
          view.resolutionMinutes,
          locale,
          this.timeZone(),
          this.clock.now(),
        ),
        dry: threshold !== null && point.value < threshold,
      };
    }
    const stale = this.staleSince();
    if (stale) {
      // The device went quiet: its last reading, with when it was taken, instead of "Jetzt".
      return {
        value: formatNumber(stale.value, locale),
        unit: this.unit(),
        label: null,
        dry: false,
      };
    }
    const key = this.capabilityKey();
    const current = key === undefined ? undefined : this.device().state[key];
    return {
      value: typeof current === 'number' ? formatNumber(current, locale) : NO_VALUE,
      unit: typeof current === 'number' ? this.unit() : null,
      label: null,
      dry: false,
    };
  });

  /**
   * The line under the value: at rest "Jetzt · zuletzt gegossen vor 3 Tagen" (the watering only
   * when the period holds one), under the pointer "Fr., 23. Okt., 23–24 Uhr · zu trocken".
   */
  protected readonly readoutLine = computed(() => {
    const readout = this.readout();
    const separator = ` ${this.text(KEYS.separator) ?? '·'} `;
    if (readout.label !== null) {
      return readout.dry ? `${readout.label}${separator}${this.text(DRY_KEY)}` : readout.label;
    }
    const stale = this.staleSince();
    const now = stale
      ? (this.text(KEYS.last, {
          time: lastLabel(stale.t, this.locale(), this.timeZone(), this.clock.now()),
        }) ?? '')
      : (this.text(KEYS.now) ?? '');
    const watered = this.lastWatering();
    if (watered === null) return now;
    const time = this.relativeTime.transform(watered);
    return `${now}${separator}${this.text(KEYS.watered, { time })}`;
  });

  /** The words that name the chart and describe it for screen readers. */
  protected readonly chartWords = computed(() => {
    this.language();
    const key = this.capabilityKey();
    const capability = key === undefined ? '' : (this.text(capabilityLabelKey(key)) ?? key);
    const summary = this.summary()
      .map((part) => this.transloco.translate(part.key, part.params))
      .join(' · ');
    return { capability, range: this.text(SPAN_KEYS[this.range()]) ?? '', summary };
  });
  /** "Bodenfeuchte, letzte 7 Tage": the name of the chart and of the table. */
  protected readonly chartLabel = computed(
    () => this.text(KEYS.chartLabel, this.chartWords()) ?? '',
  );
  /** The summary under the chart; none for a period without values. */
  protected readonly caption = computed(() => this.chartWords().summary || undefined);
  /** What stands in the chart's place: the error, or that the period holds no values. */
  protected readonly message = computed(() => {
    const state = this.state();
    if (state === 'failed') return this.text(KEYS.error) ?? undefined;
    if (state === 'ready' && this.chart() === null) return this.text(KEYS.empty) ?? undefined;
    return undefined;
  });

  /** 4 weeks list days (day, mean, low to high); the other periods list buckets (time, value). */
  private readonly daily = computed(() => {
    const history = this.history();
    return history !== null && history.range === '28d' && history.days.length > 0;
  });
  protected readonly columns = computed<UiTableColumn[]>(() => {
    const label = (key: string) => this.text(key) ?? '';
    return this.daily()
      ? [
          { label: label(KEYS.column.day) },
          { label: label(KEYS.column.mean) },
          { label: label(KEYS.column.span) },
        ]
      : [{ label: label(KEYS.column.time) }, { label: this.chartWords().capability }];
  });
  /**
   * The clock for the table: it only names "Heute" and "Gestern", so it changes with the day, not
   * with every tick of the clock (which would rebuild all rows every 30 seconds).
   */
  private readonly today = computed(() => this.clock.now(), {
    equal: (a, b) =>
      localDate(new Date(a).toISOString(), this.timeZone()) ===
      localDate(new Date(b).toISOString(), this.timeZone()),
  });
  protected readonly rows = computed<UiTableRow[]>(() => {
    const history = this.history();
    if (!history) return [];
    const rows = tableRowsOf(
      history,
      this.threshold(),
      this.waterings(),
      this.locale(),
      this.timeZone(),
      this.today(),
    );
    return rows.map((row) => ({
      key: row.key,
      cells: [row.label, ...row.values],
      note: row.notes.length > 0 ? (this.text(noteKeyOf(row)) ?? undefined) : undefined,
    }));
  });

  private requests = 0;
  private readonly refresh = new RefreshGuard();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.requests++);
    effect(() => {
      const householdId = this.household.current()?.id;
      const key = this.capabilityKey();
      const range = this.range();
      const deviceId = this.deviceId();
      untracked(() => {
        // The old values are not the new choice's: the skeleton stands in until its answer is in.
        this.history.set(null);
        this.scrub.set(null);
        this.state.set('loading');
        void this.load(householdId, deviceId, key, range, true);
      });
    });
    const reload = () =>
      void this.refresh.run(() =>
        this.load(
          this.household.current()?.id,
          this.deviceId(),
          this.capabilityKey(),
          this.range(),
          false,
        ),
      );
    const reloads = throttled(RELOAD_WINDOW_MS, reload);
    let settling: ReturnType<typeof setTimeout> | undefined;
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(settling);
      reloads.dispose();
    });
    injectLive({
      'device.state': (device) => {
        if (device.id !== this.deviceId() || settling !== undefined) return;
        settling = setTimeout(() => {
          settling = undefined;
          reloads.trigger();
        }, WRITER_SETTLE_MS);
      },
      resync: reload,
    });
  }

  protected chooseRange(range: HistoryRange | undefined): void {
    if (range) this.range.set(range);
  }

  protected retry(): void {
    this.state.set('loading');
    void this.load(
      this.household.current()?.id,
      this.deviceId(),
      this.capabilityKey(),
      this.range(),
      true,
    );
  }

  /**
   * Fetches one history. Each call starts a new request number and only the newest one may write:
   * the answer to an earlier choice of reading or period, or to an older refresh, is dropped when
   * it comes in late.
   */
  private async load(
    householdId: string | undefined,
    deviceId: string,
    key: string | undefined,
    range: HistoryRange,
    initial: boolean,
  ): Promise<void> {
    const request = ++this.requests;
    if (!householdId || key === undefined) return;
    try {
      const history = await this.api.history(householdId, deviceId, key, range);
      if (request !== this.requests) return;
      this.history.set(history);
      this.state.set('ready');
    } catch (error) {
      if (request !== this.requests) return;
      if (
        error instanceof ApiError &&
        (error.code === 'household.notFound' || error.code === 'household.forbidden')
      ) {
        this.handleError(error);
      } else if (initial || this.history() === null) {
        this.state.set('failed');
      }
      // A refresh that fails keeps the values shown; the next one tries again.
    }
  }

  /** A text of a translation key, again when the language changes or its scope arrives. */
  private text(key: string | null, params?: Record<string, string | number>): string | null {
    this.language();
    this.loaded();
    return key === null ? null : this.transloco.translate(key, params);
  }
}
