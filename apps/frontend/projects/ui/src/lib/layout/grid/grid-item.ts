import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A cell of `ui-grid` that needs more than one column: `span="full"` stretches it across the
 * whole row (the status hero over both columns from medium up, spec 3.7). Without `span` it is
 * an ordinary cell; the wrapper is only needed where a span is possible.
 */
@Component({
  selector: 'ui-grid-item',
  template: '<ng-content />',
  styleUrl: './grid-item.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-span]': 'span() ?? null' },
})
export class UiGridItem {
  readonly span = input<'full' | undefined>(undefined);
}
