import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink, type UrlTree } from '@angular/router';
import { UiIcon } from '../icon/icon';
import type { IconName } from '../icon/icon-codepoints';
import type { UiToneName } from '../tone';

/**
 * The icon container of a notice: a container of a family, `surface`, or the strong `error` of
 * critical entries (spec 4.1 rule 6). Other strong fills mark nothing here.
 */
export type UiStatusEntryTone = `${UiToneName}-container` | 'surface' | 'error';

/**
 * Where the entry sits: `entry` is the surface-container-lowest pod inside the hero or a list;
 * `row` stands alone on the page like the hero's calm row (surface-container-low, pill, 56 px:
 * the gateway block); `bare` has no surface of its own and lets the subtitle wrap, for a row
 * that already is a pod (the customise sheet's reorder list).
 */
export type UiStatusEntryVariant = 'entry' | 'row' | 'bare';

/**
 * One notice (spec 4.1 rule 6): a surface-container-lowest pod with the icon in a round container
 * of the notice's kind (`kindTone`: `error` for critical, `dry-container`, `warning-container`,
 * `secondary-container`, ...), title and subtitle, and on the right either the `value` in the
 * kind's strong colour or the `severityLabel` ("Kritisch"). With a `route` it is a link; the icon
 * container is decorative, so the link is named by its texts. Used in `ui-status-hero` and on the
 * "Alle Hinweise" page. Without a route it is plain content, and projected content sits at its end:
 * the rows of the customise sheet are such entries with a switch (spec 3.5). `variant` picks the
 * surface (see `UiStatusEntryVariant`).
 */
@Component({
  selector: 'ui-status-entry',
  imports: [NgTemplateOutlet, RouterLink, UiIcon],
  templateUrl: './status-entry.html',
  styleUrl: './status-entry.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-variant]': 'variant()' },
})
export class UiStatusEntry {
  readonly variant = input<UiStatusEntryVariant>('entry');
  readonly icon = input.required<IconName>();
  readonly kindTone = input.required<UiStatusEntryTone>();
  readonly title = input.required<string>();
  /** Makes the title a heading of this level, so a page of entries can be navigated by heading. */
  readonly headingLevel = input<2 | 3 | 4>();
  readonly subtitle = input<string>();
  /** Formatted by the caller, with its unit ("18 %"). */
  readonly value = input<string>();
  readonly severityLabel = input<string>();
  /** A path, or a `UrlTree` when the target needs query parameters (a preselected kind). */
  readonly route = input<string | UrlTree>();

  /** The strong colour of the kind's family for value and label; none on `surface`. */
  protected readonly familyTone = computed<UiToneName | null>(() => {
    const tone = this.kindTone();
    if (tone === 'surface') return null;
    return tone.replace(/-container$/, '') as UiToneName;
  });
}
