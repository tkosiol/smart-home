import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { UiToneName } from '../tone';

/** A marked range of the scale, e.g. "too dry" from 0 to 25 in `dry`. */
export interface UiProgressBandRange {
  readonly from: number;
  readonly to: number;
  readonly tone: UiToneName;
}

/**
 * A progress bar with a marked band (spec 3.3): the track shows `value` between `min` and `max`;
 * `band` paints a range in its container colour, and while the value lies inside it the fill takes
 * the band's strong colour instead of primary. The element is a `meter`: `label` names it and
 * `valueText` reads the value with its meaning ("18 percent, too dry"), both translated by the
 * caller, since colour and position alone carry nothing for a screen reader.
 */
@Component({
  selector: 'ui-progress-band',
  templateUrl: './progress-band.html',
  styleUrl: './progress-band.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'meter',
    '[attr.aria-label]': 'label()',
    '[attr.aria-valuemin]': 'min()',
    '[attr.aria-valuemax]': 'max()',
    '[attr.aria-valuenow]': 'clamped()',
    '[attr.aria-valuetext]': 'valueText()',
  },
})
export class UiProgressBand {
  readonly value = input.required<number>();
  readonly min = input(0);
  readonly max = input(100);
  readonly band = input<UiProgressBandRange | null>(null);
  readonly label = input.required<string>();
  readonly valueText = input.required<string>();

  protected readonly clamped = computed(() => this.clamp(this.value()));
  protected readonly fillPercent = computed(() => this.percent(this.clamped()));

  protected readonly bandBox = computed(() => {
    const band = this.band();
    if (!band) return null;
    const start = this.percent(this.clamp(Math.min(band.from, band.to)));
    const end = this.percent(this.clamp(Math.max(band.from, band.to)));
    return { tone: band.tone, start, width: end - start };
  });

  protected readonly fillTone = computed<UiToneName>(() => {
    const band = this.band();
    const value = this.clamped();
    if (!band) return 'primary';
    const inside = value >= Math.min(band.from, band.to) && value <= Math.max(band.from, band.to);
    return inside ? band.tone : 'primary';
  });

  private clamp(value: number): number {
    return Math.min(Math.max(value, this.min()), this.max());
  }

  /** Share of the range as 0–100; an empty range (min = max) shows nothing. */
  private percent(value: number): number {
    const span = this.max() - this.min();
    if (span <= 0) return 0;
    return ((value - this.min()) / span) * 100;
  }
}
