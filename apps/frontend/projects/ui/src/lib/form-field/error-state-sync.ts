import { Directive, DoCheck, inject } from '@angular/core';
import { MatInput } from '@angular/material/input';

/**
 * Keeps `matInput`'s error state in sync with its `errorStateMatcher`.
 * Material only re-evaluates the matcher on its own for inputs bound to a form control; our fields
 * are signal driven and have none, so the check Material does in `ngDoCheck` is repeated here.
 */
@Directive({ selector: 'input[matInput][uiErrorStateSync]' })
export class UiErrorStateSync implements DoCheck {
  private readonly input = inject(MatInput);

  ngDoCheck(): void {
    this.input.updateErrorState();
  }
}
