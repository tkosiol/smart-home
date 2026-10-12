import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** A titled part of a page; `level` keeps the heading outline correct when sections nest. */
@Component({
  selector: 'ui-section',
  templateUrl: './section.html',
  styleUrl: './section.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiSection {
  readonly heading = input.required<string>();
  readonly description = input<string>();
  readonly level = input<2 | 3>(2);
}
