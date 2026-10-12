import { AfterViewChecked, Directive, DoCheck, ElementRef, Renderer2, inject } from '@angular/core';
import { MatInput } from '@angular/material/input';

/**
 * Keeps matInput's error state and `aria-invalid` in sync with its `errorStateMatcher`.
 *
 * Material only re-evaluates the matcher on its own for inputs bound to a form control; our fields
 * are signal driven and have none, so the check Material does in `ngDoCheck` is repeated here.
 * Material also drops `aria-invalid` while a required input is empty (`(empty && required) ? null`);
 * a field that shows an error must stay invalid, so the attribute is written after Material's host
 * binding has run, on every check.
 */
@Directive({ selector: 'input[matInput][uiFieldStateSync]' })
export class UiFieldStateSync implements DoCheck, AfterViewChecked {
  private readonly input = inject(MatInput);
  private readonly element = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private readonly renderer = inject(Renderer2);

  ngDoCheck(): void {
    this.input.updateErrorState();
  }

  ngAfterViewChecked(): void {
    this.renderer.setAttribute(
      this.element,
      'aria-invalid',
      this.input.errorState ? 'true' : 'false',
    );
  }
}
