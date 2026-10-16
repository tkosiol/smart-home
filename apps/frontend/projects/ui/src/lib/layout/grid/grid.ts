import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { UiSpace } from '../space';

/**
 * Responsive grid: as many columns as fit, each at least `min` wide (never wider than the grid).
 * `xs` is the grid of side-value pods (three across a phone, spec 3.3).
 */
@Component({
  selector: 'ui-grid',
  template: '<ng-content />',
  styleUrl: './grid.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-min]': 'min()', '[attr.data-gap]': 'gap()' },
})
export class UiGrid {
  readonly min = input<'xs' | 'sm' | 'md' | 'lg'>('md');
  readonly gap = input<UiSpace>('md');
}
