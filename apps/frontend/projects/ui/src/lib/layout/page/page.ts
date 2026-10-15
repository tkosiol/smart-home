import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

/**
 * Content column of a screen: readable width, responsive padding and the page heading (h1).
 * With `headingHidden` the h1 is there for screen readers only: the overview, whose title the
 * top app bar already carries as the household name (spec 3.1), shows no heading of its own.
 */
@Component({
  selector: 'ui-page',
  templateUrl: './page.html',
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiPage {
  readonly heading = input<string>();
  readonly description = input<string>();
  readonly headingHidden = input(false, { transform: booleanAttribute });
}
