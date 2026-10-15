import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiIcon } from '../icon/icon';
import type { UiToneName } from '../tone';

/**
 * What stands at the right of the card's head: plain text ("3 Geräte · alles ok"), or with a
 * `tone` a chip in that family's container colour ("2 Hinweise" in dry-container).
 */
export interface UiRoomCardSummary {
  readonly text: string;
  readonly tone?: UiToneName;
}

/**
 * The card of a room (spec 3.1) and, before rooms exist, of the block "Geräte": a
 * surface-container-low card with the heading (a link to `route` when there is one, with a
 * chevron), the `summary` on the right, and the projected content below, usually a `ui-pod-row`.
 * `level` keeps the heading outline right: 2 on a page, 3 inside a section.
 */
@Component({
  selector: 'ui-room-card',
  imports: [NgTemplateOutlet, RouterLink, UiIcon],
  templateUrl: './room-card.html',
  styleUrl: './room-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiRoomCard {
  readonly heading = input.required<string>();
  readonly route = input<string>();
  readonly summary = input<UiRoomCardSummary | null>(null);
  readonly level = input<2 | 3>(2);
}
