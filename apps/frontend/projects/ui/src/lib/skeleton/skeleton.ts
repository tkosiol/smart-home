import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  numberAttribute,
} from '@angular/core';
import { EXPANDED } from '../adaptive-shell/adaptive-shell';
import { mediaQuerySignal } from '../theme/media-queries';

/**
 * Placeholder while content loads; hidden from assistive technology (announce loading around it).
 * `chart` is a block at the height of `ui-chart` (the large one from the Expanded window class),
 * so a card keeps its size while a history loads.
 */
@Component({
  selector: 'ui-skeleton',
  templateUrl: './skeleton.html',
  styleUrl: './skeleton.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[attr.data-variant]': 'variant()',
    '[attr.data-large]': "large() ? '' : null",
  },
})
export class UiSkeleton {
  readonly variant = input<'text' | 'block' | 'circle' | 'chart'>('text');
  readonly lines = input(1, { transform: numberAttribute });

  protected readonly large = mediaQuerySignal(EXPANDED);
  protected readonly lineIndexes = computed(() =>
    Array.from({ length: Math.max(1, Math.floor(this.lines())) }, (_, index) => index),
  );
}
