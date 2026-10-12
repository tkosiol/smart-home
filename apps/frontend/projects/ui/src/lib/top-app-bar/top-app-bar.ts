import { ChangeDetectionStrategy, Component, Directive, input } from '@angular/core';

/** Marks the element holding the top app bar's actions. */
@Directive({ selector: '[uiTopAppBarActions]' })
export class UiTopAppBarActions {}

/**
 * M3 small top app bar: a single-line title and trailing actions. The title is plain text, not a
 * heading: the page's h1 belongs to `ui-page`.
 */
@Component({
  selector: 'ui-top-app-bar',
  templateUrl: './top-app-bar.html',
  styleUrl: './top-app-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiTopAppBar {
  readonly heading = input.required<string>();
}
