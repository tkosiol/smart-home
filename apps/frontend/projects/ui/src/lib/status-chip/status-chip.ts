import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { UiToneName } from '../tone';

/** The chip's fill: the container of a colour family, or the neutral `surface`. */
export type UiStatusChipTone = UiToneName | 'surface';

/**
 * A state in words as a pill ("Zu trocken", "Offline", "Standard"): the chip of a device pod,
 * standing alone. Its container colour comes from `tone` (spec 2.4: status colours mark only
 * states); `surface` is the neutral chip. Plain text, no control: the caller names what it is
 * about by placing it next to the value or field it belongs to.
 */
@Component({
  selector: 'ui-status-chip',
  template: '{{ text() }}',
  styleUrl: './status-chip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tone]': 'fill()' },
})
export class UiStatusChip {
  readonly text = input.required<string>();
  readonly tone = input<UiStatusChipTone>('surface');

  protected readonly fill = computed(() => {
    const tone = this.tone();
    return tone === 'surface' ? tone : `${tone}-container`;
  });
}
