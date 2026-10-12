import { ChangeDetectionStrategy, Component, booleanAttribute, input, model } from '@angular/core';
import {
  MatButtonToggle,
  MatButtonToggleGroup,
  type MatButtonToggleChange,
} from '@angular/material/button-toggle';
import { UiIcon } from '../icon/icon';
import type { IconName } from '../icon/icon-codepoints';

export interface UiSegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: IconName;
}

/** Single choice among few options (M3 segmented button); bind with `[(value)]`. */
@Component({
  selector: 'ui-segmented-button',
  imports: [MatButtonToggleGroup, MatButtonToggle, UiIcon],
  templateUrl: './segmented-button.html',
  styleUrl: './segmented-button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiSegmentedButton<T extends string> {
  readonly options = input.required<readonly UiSegmentOption<T>[]>();
  readonly value = model<T>();
  readonly label = input.required<string>();
  readonly disabled = input(false, { transform: booleanAttribute });

  protected select(change: MatButtonToggleChange): void {
    this.value.set(change.value as T);
  }
}
