import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, booleanAttribute, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiIcon } from '../icon/icon';
import type { IconName } from '../icon/icon-codepoints';

/** `standard` is M3's plain icon button; `tonal` sits on a surface-container-high disc. */
export type UiIconButtonVariant = 'standard' | 'tonal';

/**
 * Icon-only button on a native `<button>` (or `<a>`), without Material; `label` is its accessible name (and must come translated from the caller).
 * Projected content replaces the plain icon, e.g. an icon inside a `ui-badge`. With a `route` it
 * renders as a link instead and `pressed` never fires.
 */
@Component({
  selector: 'ui-icon-button',
  imports: [NgTemplateOutlet, RouterLink, UiIcon],
  templateUrl: './icon-button.html',
  styleUrl: './icon-button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-variant]': 'variant()' },
})
export class UiIconButton {
  readonly variant = input<UiIconButtonVariant>('standard');
  readonly icon = input.required<IconName>();
  readonly label = input.required<string>();
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly route = input<string>();
  readonly pressed = output<void>();
}
