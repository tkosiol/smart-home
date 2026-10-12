import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
} from '@angular/core';
import { ICON_CODEPOINTS, type IconName } from './icon-codepoints';

export type UiIconSize = 'sm' | 'md' | 'lg';

/** A Material Symbol from the self-hosted subset; decorative unless it has a label. */
@Component({
  selector: 'ui-icon',
  template: '{{ glyph() }}',
  styleUrl: './icon.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.role]': "label() ? 'img' : null",
    '[attr.aria-label]': 'label() ?? null',
    '[attr.aria-hidden]': "label() ? null : 'true'",
    '[attr.data-size]': 'size()',
    '[class.ui-icon--filled]': 'filled()',
  },
})
export class UiIcon {
  readonly name = input.required<IconName>();
  readonly label = input<string>();
  readonly filled = input(false, { transform: booleanAttribute });
  readonly size = input<UiIconSize>('md');

  protected readonly glyph = computed(() => String.fromCodePoint(ICON_CODEPOINTS[this.name()]));
}
