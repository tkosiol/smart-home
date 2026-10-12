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

/** Marks the element holding a banner's actions. */
@Directive({ selector: '[uiBannerActions]' })
export class UiBannerActions {}

export type UiBannerTone = 'info' | 'warning' | 'offline';

const DEFAULT_ICON: Record<UiBannerTone, IconName> = {
  info: 'info',
  warning: 'warning',
  offline: 'cloud_off',
};

/** Prominent, persistent message at the top of content (M3 banner); announced politely. */
@Component({
  selector: 'ui-banner',
  imports: [UiIcon],
  templateUrl: './banner.html',
  styleUrl: './banner.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', '[attr.data-tone]': 'tone()' },
})
export class UiBanner {
  readonly tone = input<UiBannerTone>('info');
  readonly icon = input<IconName>();
  readonly heading = input<string>();

  protected readonly actions = contentChild(UiBannerActions);
  protected readonly shownIcon = computed(() => this.icon() ?? DEFAULT_ICON[this.tone()]);
}
