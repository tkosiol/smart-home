import { ChangeDetectionStrategy, Component, booleanAttribute, input, model } from '@angular/core';
import type { ErrorStateMatcher } from '@angular/material/core';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { UiFieldStateSync } from '../form-field/field-state-sync';

/** Outlined text field; the caller decides about errors (`error` set ⇒ invalid). Bind `[(value)]`. */
@Component({
  selector: 'ui-text-field',
  imports: [MatFormField, MatLabel, MatHint, MatError, MatInput, UiFieldStateSync],
  templateUrl: './text-field.html',
  styleUrl: './text-field.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiTextField {
  readonly label = input.required<string>();
  readonly value = model('');
  readonly type = input<'text' | 'email' | 'password' | 'search' | 'url' | 'tel'>('text');
  readonly hint = input<string>();
  readonly error = input<string | null>();
  readonly required = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly autocomplete = input<string>();
  readonly name = input<string>();

  protected readonly errorMatcher: ErrorStateMatcher = { isErrorState: () => !!this.error() };

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement).value);
  }
}
