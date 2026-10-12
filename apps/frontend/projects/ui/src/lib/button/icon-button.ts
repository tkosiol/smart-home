import { ChangeDetectionStrategy, Component, booleanAttribute, input, output } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { UiIcon } from '../icon/icon';
import type { IconName } from '../icon/icon-codepoints';

/** Icon-only button; `label` is its accessible name (and must come translated from the caller). */
@Component({
  selector: 'ui-icon-button',
  imports: [MatIconButton, UiIcon],
  templateUrl: './icon-button.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiIconButton {
  readonly icon = input.required<IconName>();
  readonly label = input.required<string>();
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly pressed = output<void>();
}
