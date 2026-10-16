import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TRANSLOCO_SCOPE, TranslocoPipe } from '@jsverse/transloco';
import { UiIcon } from '../icon/icon';

/** `calm`: nothing open; `attention`: warnings or infos; `critical`: at least one critical entry. */
export type UiStatusHeroTone = 'calm' | 'attention' | 'critical';

let nextId = 0;

/**
 * The status block of the overview (spec 3.1, 4.1): a `region` named by its heading. With
 * `attention` or `critical` it is a card in primary-container or error-container (rule 6) with
 * the heading "{heading} · {count}", "{k} kritisch" when `criticalCount` is above zero, the
 * projected `ui-status-entry`s (the caller limits them to three, rule 5) and always the link
 * "Alle {count} Hinweise" to `moreRoute`, with `moreLabel` ("3 weitere Gruppen") beside it. With
 * `calm` it is the 56 px row (rule 7): ok icon container, "Alles in Ordnung" and the projected
 * detail text, as one link to `moreRoute`; `heading`, counts and `moreLabel` are not shown, and
 * the region is named by "Alles in Ordnung" together with the detail.
 */
@Component({
  selector: 'ui-status-hero',
  imports: [NgTemplateOutlet, RouterLink, TranslocoPipe, UiIcon],
  templateUrl: './status-hero.html',
  styleUrl: './status-hero.scss',
  // Own texts (`ui.*`) only; a page's lazy Transloco scope must not prefix them.
  providers: [{ provide: TRANSLOCO_SCOPE, useValue: null }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tone]': 'tone()' },
})
export class UiStatusHero {
  readonly tone = input.required<UiStatusHeroTone>();
  /** Translated by the caller ("Braucht Aufmerksamkeit"); the count is appended here. */
  readonly heading = input.required<string>();
  /** Entries after suppression (rule 4). */
  readonly count = input(0);
  readonly criticalCount = input(0);
  /** Translated by the caller ("3 weitere Gruppen"); shown beside the link to all notices. */
  readonly moreLabel = input<string>();
  readonly moreRoute = input.required<string>();

  protected readonly headingId = `ui-status-hero-${nextId++}`;
  protected readonly detailId = `${this.headingId}-detail`;
  protected readonly labelledBy = computed(() =>
    this.tone() === 'calm' ? `${this.headingId} ${this.detailId}` : this.headingId,
  );
}
