import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, booleanAttribute, input, output } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { UiIcon } from '../icon/icon';
import type { IconName } from '../icon/icon-codepoints';

export type UiButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated';

/**
 * M3 button; the label is projected content. Listen to `pressed`, not `click`. With a `route` it
 * renders as a link instead and `pressed` never fires.
 */
@Component({
  selector: 'ui-button',
  imports: [MatButton, NgTemplateOutlet, RouterLink, UiIcon],
  templateUrl: './button.html',
  styleUrl: './button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiButton {
  readonly variant = input<UiButtonVariant>('filled');
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly icon = input<IconName>();
  readonly route = input<string>();
  readonly pressed = output<void>();
}
