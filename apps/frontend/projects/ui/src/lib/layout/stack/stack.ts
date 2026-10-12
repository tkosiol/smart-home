import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import type { UiSpace } from '../space';

/** Arranges its children in a column or row with token-based spacing. */
@Component({
  selector: 'ui-stack',
  template: '<ng-content />',
  styleUrl: './stack.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-gap]': 'gap()',
    '[attr.data-direction]': 'direction()',
    '[attr.data-align]': 'align()',
    '[attr.data-justify]': 'justify()',
    '[class.ui-stack--wrap]': 'wrap()',
  },
})
export class UiStack {
  readonly gap = input<UiSpace>('md');
  readonly direction = input<'column' | 'row'>('column');
  readonly align = input<'stretch' | 'start' | 'center' | 'end'>('stretch');
  readonly justify = input<'start' | 'center' | 'end' | 'space-between'>('start');
  readonly wrap = input(false, { transform: booleanAttribute });
}
