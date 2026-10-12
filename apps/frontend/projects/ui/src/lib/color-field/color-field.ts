import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  linkedSignal,
  model,
  signal,
} from '@angular/core';
import type { ErrorStateMatcher } from '@angular/material/core';
import { MatError, MatFormField, MatHint, MatPrefix, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { UiFieldStateSync } from '../form-field/field-state-sync';
import { normalizeHexColor } from './hex-color';

/** Hex color with a native picker; only valid, normalized colors reach `[(value)]`. */
@Component({
  selector: 'ui-color-field',
  imports: [MatFormField, MatLabel, MatHint, MatError, MatInput, MatPrefix, UiFieldStateSync],
  templateUrl: './color-field.html',
  styleUrl: './color-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiColorField {
  readonly label = input.required<string>();
  readonly pickerLabel = input.required<string>();
  readonly invalidMessage = input.required<string>();
  readonly hint = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly value = model('#000000');

  /**
   * What the user typed. Follows `value` when that changes from outside, but keeps the typed text
   * (e.g. `8a5`) while it normalizes to the new value – resetting it would overwrite typing midway.
   */
  protected readonly draft = linkedSignal<string, string>({
    source: this.value,
    computation: (value, previous) =>
      previous !== undefined && normalizeHexColor(previous.value) === value
        ? previous.value
        : value,
  });
  protected readonly touched = signal(false);
  protected readonly invalid = computed(() => normalizeHexColor(this.draft()) === null);
  protected readonly showError = computed(() => this.invalid() && this.touched());
  protected readonly errorMatcher: ErrorStateMatcher = { isErrorState: () => this.showError() };

  protected onText(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.draft.set(raw);
    const hex = normalizeHexColor(raw);
    if (hex !== null && hex !== this.value()) this.value.set(hex);
  }

  protected onPick(event: Event): void {
    const hex = normalizeHexColor((event.target as HTMLInputElement).value);
    if (hex !== null) this.value.set(hex);
  }
}
