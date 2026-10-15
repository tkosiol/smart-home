import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { UiToneName } from '../tone';

/** `hero`: the main value of a device page; `large`: a headline value; `medium`: pods and side values. */
export type UiValueDisplaySize = 'hero' | 'large' | 'medium';

/**
 * A measured value with its unit and label, in tabular digits (spec 2.3). The caller formats the
 * value for the locale; nothing here is a heading. Without a `tone` the text inherits its colour
 * (e.g. on-tertiary-container inside a soil hero); with one it takes that family's strong colour.
 */
@Component({
  selector: 'ui-value-display',
  templateUrl: './value-display.html',
  styleUrl: './value-display.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-size]': 'size()', '[attr.data-tone]': 'tone() ?? null' },
})
export class UiValueDisplay {
  readonly value = input.required<string>();
  readonly unit = input<string>();
  readonly label = input<string>();
  readonly size = input<UiValueDisplaySize>('medium');
  readonly tone = input<UiToneName>();
}
