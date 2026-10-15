import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import { UiIconButton } from '../../button/icon-button';

/**
 * Content column of a screen: readable width, responsive padding and the page heading (h1).
 * With `headingHidden` the h1 is there for screen readers only: the overview, whose title the
 * top app bar already carries as the household name (spec 3.1), shows no heading of its own.
 * With `backRoute` (and `backLabel`, its translated name) a tonal back button stands before the
 * heading, and the description becomes the small line under it ("Pflanze · Büro", spec 3.3).
 */
@Component({
  selector: 'ui-page',
  imports: [UiIconButton],
  templateUrl: './page.html',
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiPage {
  readonly heading = input<string>();
  readonly description = input<string>();
  readonly headingHidden = input(false, { transform: booleanAttribute });
  readonly backRoute = input<string>();
  /** The accessible name of the back button ("Zur Übersicht"); required with `backRoute`. */
  readonly backLabel = input<string>();
}
