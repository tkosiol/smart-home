import { ChangeDetectionStrategy, Component, booleanAttribute, input, model } from '@angular/core';
import {
  MatChipAvatar,
  MatChipListbox,
  MatChipOption,
  type MatChipListboxChange,
} from '@angular/material/chips';
import { UiIcon } from '../icon/icon';
import type { UiOption } from '../option';

/**
 * Filter chips (spec: ui-chip). Rendered from `options` because Material's listbox only finds chip
 * options declared in its own template. Bind the selection with `[(selected)]`.
 */
@Component({
  selector: 'ui-chip-set',
  imports: [MatChipListbox, MatChipOption, MatChipAvatar, UiIcon],
  templateUrl: './chip-set.html',
  styleUrl: './chip-set.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiChipSet<T extends string> {
  readonly options = input.required<readonly UiOption<T>[]>();
  readonly selected = model<readonly T[]>([]);
  readonly label = input.required<string>();
  readonly multiple = input(true, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });

  protected change(event: MatChipListboxChange): void {
    const value = event.value as T | T[] | undefined | null;
    this.selected.set(value == null ? [] : Array.isArray(value) ? value : [value]);
  }
}
