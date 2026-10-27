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
  UiFormatContext,
  UiIconButton,
  type UiOption,
  UiList,
  UiListItem,
  UiRelativeTimePipe,
  UiSkeleton,
  UiStack,
  UiValueDisplay,
} from '@smart/ui';
import { UiChipSet, UiSegmentedButton, type UiChipOption } from '@smart/ui/forms';
import { ApiError } from '../../core/api';
import { HouseholdContext, injectHouseholdErrorHandler } from '../../core/household';
import { RefreshGuard, refreshWhileVisible } from '../../core/refresh';
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
  pointLabel,
  summaryOf,
  tableRowsOf,
  thresholdFor,
  type TableRow,
} from './history-model';

/** How often the shown history is fetched again while the page is in view. */
export const HISTORY_REFRESH_MS = 300_000;
const DEFAULT_RANGE: HistoryRange = '7d';

/**
 * The "Verlauf" of a device (spec 4.3): one reading at a time (chips, the main value first) over
 * 24 hours, 7 days or 4 weeks, as a chart or, on request, a table. Above the chart stands the value
 * (the current one, or the one under the pointer with the time it stands for), below it what
 * happened in the period. The history is fetched again every five minutes; an answer to an older
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
    UiIconButton,
    UiList,
    UiListItem,
    UiRelativeTimePipe,
    UiSegmentedButton,
    UiSkeleton,
    UiStack,
    UiValueDisplay,
  ],
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
      <ui-stack gap="md">
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
            size="large"
            [value]="readout().value"
            [unit]="readout().unit ?? undefined"
          />
          <p>
            @if (readout().label; as label) {
              {{ label }}
              @if (readout().dry) {
                {{ 'devices.history.separator' | transloco }}
                {{ dryKey | transloco }}
              }
            } @else {
              {{ 'devices.history.now' | transloco }}
              @if (lastWatering(); as watered) {
                {{ 'devices.history.separator' | transloco }}
                {{ 'devices.history.watered' | transloco: { time: watered | uiRelativeTime } }}
              }
            }
          </p>
        </div>
        @switch (state()) {
          @case ('loading') {
            <ui-skeleton variant="block" />
          }
          @case ('failed') {
            <ui-stack gap="sm" align="start">
              <p>{{ 'devices.history.error.text' | transloco }}</p>
              <ui-button variant="tonal" (pressed)="retry()">{{
                'devices.history.error.retry' | transloco
              }}</ui-button>
            </ui-stack>
          }
          @default {
            @if (chart(); as chart) {
              @if (table()) {
                <ui-list>
                  @for (row of rows(); track row.key) {
                    <ui-list-item
                      [headline]="row.headline"
                      [supporting]="row.notes.length > 0 ? (noteKey(row) | transloco) : undefined"
                      [trailingText]="row.value"
                    />
                  }
                </ui-list>
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
                  [label]="'devices.history.chart.label' | transloco: chartWords()"
                  [description]="'devices.history.chart.description' | transloco: chartWords()"
                  (scrubbed)="scrub.set($event)"
                />
              }
              @if (summary().length > 0) {
                <p>
                  @for (part of summary(); track part.key; let first = $first) {
                    @if (!first) {
                      {{ 'devices.history.separator' | transloco }}
                    }
                    {{ part.key | transloco: part.params }}
                  }
                </p>
              }
            } @else {
              <p>{{ 'devices.history.empty' | transloco }}</p>
            }
          }
        }
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
  private readonly language = toSignal(this.transloco.langChanges$);

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

  protected readonly dryKey = DRY_KEY;
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
  protected readonly band = computed(() => {
    const below = this.chart()?.band ?? null;
    if (below === null) return null;
    return {
      below,
      label: this.text(DRY_KEY) ?? '',
      valueLabel: formatNumber(below, this.locale()),
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
  protected readonly rows = computed<TableRow[]>(() => {
    const history = this.history();
    return history
      ? tableRowsOf(history, this.threshold(), this.waterings(), this.locale(), this.timeZone())
      : [];
  });

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
        label: pointLabel(point.t, view.resolutionMinutes, locale, this.timeZone()),
        dry: threshold !== null && point.value < threshold,
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
    refreshWhileVisible(
      this.refresh,
      () =>
        this.load(
          this.household.current()?.id,
          this.deviceId(),
          this.capabilityKey(),
          this.range(),
          false,
        ),
      HISTORY_REFRESH_MS,
    );
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

  protected noteKey(row: TableRow): string {
    return row.notes.length === 2
      ? NOTE_KEYS.both
      : row.notes[0] === 'dry'
        ? NOTE_KEYS.dry
        : NOTE_KEYS.watered;
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

  /** A text of a translation key, again when the language changes. */
  private text(key: string | null): string | null {
    this.language();
    return key === null ? null : this.transloco.translate(key);
  }
}
