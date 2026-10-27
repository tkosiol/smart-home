import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { EXPANDED } from '../../adaptive-shell/adaptive-shell';
import { mediaQuerySignal } from '../../theme/media-queries';
import type { UiSpace } from '../space';

/**
 * Responsive grid: as many columns as fit, each at least `min` wide (never wider than the grid).
 * `xs` is the grid of side-value pods (three across a phone, spec 3.3). `split` is one column
 * up to the Expanded window class and two equal columns from there (the device page: values
 * left, history right), however wide the grid is.
 */
@Component({
  selector: 'ui-grid',
  template: '<ng-content />',
  styleUrl: './grid.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-min]': 'min()',
    '[attr.data-gap]': 'gap()',
    '[attr.data-wide]': "wide() ? '' : null",
  },
})
export class UiGrid {
  readonly min = input<'xs' | 'sm' | 'md' | 'lg' | 'split'>('md');
  readonly gap = input<UiSpace>('md');

  protected readonly wide = mediaQuerySignal(EXPANDED);
}
