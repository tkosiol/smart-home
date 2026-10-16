import { ChangeDetectionStrategy, Component, Directive, input } from '@angular/core';

/** Marks the element holding the top app bar's actions. */
@Directive({ selector: '[uiTopAppBarActions]' })
export class UiTopAppBarActions {}

/** `small` is the M3 small top app bar; `large` shows the title big (compact windows, spec 3.1). */
export type UiTopAppBarSize = 'small' | 'large';

/**
 * M3 top app bar: a single-line title and trailing actions. The title is plain text, not a
 * heading: the page's h1 belongs to `ui-page`. The caller picks `size` per window class; the bar
 * does not watch the viewport itself.
 */
@Component({
  selector: 'ui-top-app-bar',
  templateUrl: './top-app-bar.html',
  styleUrl: './top-app-bar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-size]': 'size()' },
})
export class UiTopAppBar {
  readonly heading = input.required<string>();
  readonly size = input<UiTopAppBarSize>('small');
}
