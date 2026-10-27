import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { EXPANDED } from '../adaptive-shell/adaptive-shell';
import { mediaQuerySignal } from '../theme/media-queries';

/**
 * A chart or a table with its caption below it (`figure` and `figcaption`), never shorter than a
 * chart with a caption line, so a card keeps its size whatever the figure shows: the chart, the
 * table, a skeleton. With a `message` it shows that centred where the chart would be (nothing to
 * show yet, an error) and its content beneath the message, which is then an action such as a
 * "try again" button. The chart height follows the window class like `ui-chart` does.
 */
@Component({
  selector: 'ui-figure',
  templateUrl: './figure.html',
  styleUrl: './figure.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-large]': "large() ? '' : null" },
})
export class UiFigure {
  readonly caption = input<string>();
  readonly message = input<string>();

  protected readonly large = mediaQuerySignal(EXPANDED);
}
