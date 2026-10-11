import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiIcon } from '../icon/icon';
import type { IconName } from '../icon/icon-codepoints';

/** One entry of `ui-list`: a link when it has a route and is enabled, otherwise static text. */
@Component({
  selector: 'ui-list-item',
  imports: [NgTemplateOutlet, RouterLink, UiIcon],
  templateUrl: './list-item.html',
  styleUrl: './list-item.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'listitem' },
})
export class UiListItem {
  readonly headline = input.required<string>();
  readonly supporting = input<string>();
  readonly icon = input<IconName>();
  readonly trailingText = input<string>();
  readonly route = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });
}
