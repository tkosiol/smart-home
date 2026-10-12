import { ChangeDetectionStrategy, Component, Directive, contentChild, input } from '@angular/core';
import { UiIcon } from '../icon/icon';
import type { IconName } from '../icon/icon-codepoints';

/** Marks the element holding an empty state's actions. */
@Directive({ selector: '[uiEmptyStateActions]' })
export class UiEmptyStateActions {}

/** Explains what will appear here and, optionally, how to start. */
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

  protected readonly actions = contentChild(UiEmptyStateActions);
}
