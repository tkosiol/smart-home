import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  computed,
  contentChild,
  input,
} from '@angular/core';
import { UiIcon } from '../icon/icon';
import type { IconName } from '../icon/icon-codepoints';
import type { UiToneName } from '../tone';

/** Marks the element holding an empty state's actions. */
@Directive({ selector: '[uiEmptyStateActions]' })
export class UiEmptyStateActions {}

/**
 * Explains what will appear here and, optionally, how to start. With a `tone` the icon sits in a
 * round disc in that family's container colour ("Nichts zu tun" with the ok disc, spec 3.4).
 */
@Component({
  selector: 'ui-empty-state',
  imports: [UiIcon],
  templateUrl: './empty-state.html',
  styleUrl: './empty-state.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiEmptyState {
  readonly icon = input.required<IconName>();
  readonly heading = input.required<string>();
  readonly description = input<string>();
  readonly level = input<2 | 3>(2);
  readonly tone = input<UiToneName>();

  protected readonly actions = contentChild(UiEmptyStateActions);
  protected readonly disc = computed(() => {
    const tone = this.tone();
    return tone ? `${tone}-container` : null;
  });
}
