import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { UiSpace } from '../space';

/** Responsive grid: as many columns as fit, each at least `min` wide (never wider than the grid). */
@Component({
  selector: 'ui-grid',
  template: '<ng-content />',
  styleUrl: './grid.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-min]': 'min()', '[attr.data-gap]': 'gap()' },
})
export class UiGrid {
  readonly min = input<'sm' | 'md' | 'lg'>('md');
  readonly gap = input<UiSpace>('md');
}
