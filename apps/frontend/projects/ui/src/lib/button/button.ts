import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, booleanAttribute, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiIcon } from '../icon/icon';
import type { IconName } from '../icon/icon-codepoints';

export type UiButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated';

/**
 * M3 button on a native `<button>` (or `<a>`), without Material; the label is projected content. Listen to `pressed`, not `click`. With a `route` it
 * renders as a link instead and `pressed` never fires. `fullWidth` stretches the button across
 * its container (the primary button of the sign-in card, spec 3.6).
 */
@Component({
  selector: 'ui-button',
  imports: [NgTemplateOutlet, RouterLink, UiIcon],
  templateUrl: './button.html',
  styleUrl: './button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-variant]': 'variant()',
    '[attr.data-icon]': "icon() ? '' : null",
    '[attr.data-full-width]': "fullWidth() ? '' : null",
  },
})
export class UiButton {
  readonly variant = input<UiButtonVariant>('filled');
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly icon = input<IconName>();
  readonly route = input<string>();
  readonly fullWidth = input(false, { transform: booleanAttribute });
  readonly pressed = output<void>();
}
