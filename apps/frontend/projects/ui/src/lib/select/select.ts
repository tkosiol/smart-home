import { ChangeDetectionStrategy, Component, booleanAttribute, input, model } from '@angular/core';
import { MatOption } from '@angular/material/core';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatSelect, type MatSelectChange } from '@angular/material/select';
import type { UiOption } from '../option';

/**
 * Single choice from a list that opens on demand (M3 outlined select); bind with `[(value)]`.
 * For more or longer options than a segmented button fits on a phone. Option icons are not shown.
 */
@Component({
  selector: 'ui-select',
  imports: [MatFormField, MatLabel, MatHint, MatSelect, MatOption],
  templateUrl: './select.html',
  styleUrl: './select.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiSelect<T extends string> {
  readonly label = input.required<string>();
  readonly options = input.required<readonly UiOption<T>[]>();
  readonly value = model<T>();
  readonly hint = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });

  protected select(change: MatSelectChange): void {
    this.value.set(change.value as T);
  }
}
