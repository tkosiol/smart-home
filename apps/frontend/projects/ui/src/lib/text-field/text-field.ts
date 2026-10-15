import { ChangeDetectionStrategy, Component, booleanAttribute, input, model } from '@angular/core';
import type { ErrorStateMatcher } from '@angular/material/core';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { UiFieldStateSync } from '../form-field/field-state-sync';

/** Outlined text field (single line, or `multiline`); the caller decides about errors (`error` set ⇒ invalid). Bind `[(value)]`. */
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
  /** Keyboard hint on touch devices, e.g. `numeric` for a code of digits. */
  readonly inputmode = input<'text' | 'numeric' | 'decimal' | 'email' | 'tel' | 'search' | 'url'>();
  /** The native control's `name`. (Bound to `MatInput`, whose own host binding owns the attribute.) */
  readonly name = input<string>();
  /** A textarea instead of a single-line input, for text with line breaks (e.g. a pasted PEM). */
  readonly multiline = input(false, { transform: booleanAttribute });
  /**
   * Text that is not prose (a certificate, an ID): no spell check (a browser may send the text to a
   * cloud service), no automatic capitalization or correction.
   */
  readonly verbatim = input(false, { transform: booleanAttribute });
  /** Visible lines of a multiline field. */
  readonly rows = input(4);

  protected readonly errorMatcher: ErrorStateMatcher = { isErrorState: () => !!this.error() };

  protected onInput(event: Event): void {
    this.value.set((event.target as HTMLInputElement | HTMLTextAreaElement).value);
  }
}
