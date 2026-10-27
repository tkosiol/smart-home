import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { UiToneName } from '../tone';

/**
 * `hero`: the main value of a device page; `large`: a headline value; `medium`: pods and side
 * values; `readout`: the value above a chart, with a quiet unit and the label as a supporting line.
 */
export type UiValueDisplaySize = 'hero' | 'large' | 'medium' | 'readout';

/**
 * A measured value with its unit and label, in tabular digits (spec 2.3). The caller formats the
 * value for the locale; nothing here is a heading. Without a `tone` all text, label included,
 * inherits its colour from the surface it sits on (on-primary in a lit lamp pod, on-tertiary-container
 * in a soil hero); with one it takes that family's strong colour. The `readout` is the exception:
 * its unit and label are supporting text in on-surface-variant. The hero's label stands before the
 * value, in the DOM as on screen; the other sizes read value, then label.
 */
@Component({
  selector: 'ui-value-display',
  imports: [NgTemplateOutlet],
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
