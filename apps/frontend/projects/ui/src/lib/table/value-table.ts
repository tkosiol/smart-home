import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { EXPANDED } from '../adaptive-shell/adaptive-shell';
import { mediaQuerySignal } from '../theme/media-queries';

export interface UiTableColumn {
  readonly label: string;
  /** Where the text sits; by default the first column starts and the others (numbers) end. */
  readonly align?: 'start' | 'end';
}

export interface UiTableRow {
  readonly key: string;
  /** One text per column, formatted by the caller. */
  readonly cells: readonly string[];
  /** A second line under the first cell ("zeitweise zu trocken · gegossen"). */
  readonly note?: string;
}

/**
 * The values of a chart as a table in the chart's place, at its height (spec 6c-1 4.3): a
 * scrolling box on surface-container-lowest whose header row stays in view. The box is a named
 * group in the tab order (like `ui-chart`, and no landmark), so the keyboard can scroll it;
 * `label` names it ("Bodenfeuchte, letzte 7 Tage").
 */
@Component({
  selector: 'ui-value-table',
  templateUrl: './value-table.html',
  styleUrl: './value-table.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-large]': "large() ? '' : null" },
})
export class UiValueTable {
  readonly columns = input.required<readonly UiTableColumn[]>();
  readonly rows = input.required<readonly UiTableRow[]>();
  readonly label = input.required<string>();

  protected readonly large = mediaQuerySignal(EXPANDED);
  protected readonly aligns = computed(() =>
    this.columns().map((column, index) => column.align ?? (index === 0 ? 'start' : 'end')),
  );
}
