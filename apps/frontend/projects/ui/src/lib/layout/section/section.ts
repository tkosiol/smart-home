import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { UiToneName } from '../../tone';

/**
 * A titled part of a page; `level` keeps the heading outline correct when sections nest. With a
 * `tone` the heading is a section label (spec 2.3: label-small, capitals) in the strong colour of
 * that family: the severities of "Alle Hinweise" (spec 3.4).
 */
@Component({
  selector: 'ui-section',
  templateUrl: './section.html',
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tone]': 'tone() ?? null' },
})
export class UiSection {
  readonly heading = input.required<string>();
  readonly description = input<string>();
  readonly level = input<2 | 3>(2);
  readonly tone = input<UiToneName>();
}
