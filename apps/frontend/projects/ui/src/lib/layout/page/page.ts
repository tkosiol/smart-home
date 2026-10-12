import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Content column of a screen: readable width, responsive padding and the page heading (h1). */
@Component({
  selector: 'ui-page',
  templateUrl: './page.html',
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiPage {
  readonly heading = input<string>();
  readonly description = input<string>();
}
