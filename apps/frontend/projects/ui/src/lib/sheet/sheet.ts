import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  afterNextRender,
  contentChild,
  inject,
  input,
} from '@angular/core';
import { UiSheetRef, type UiSheetPresentation } from './sheet-ref';

/** Marks the element holding a sheet's actions ("Zurücksetzen", "Fertig"). */
@Directive({ selector: '[uiSheetActions]' })
export class UiSheetActions {}

let nextId = 0;

/**
 * The frame of a sheet's content (spec 3.5): the drag handle (bottom sheet only), heading and
 * description, the projected content and the actions at the end. The heading names the
 * surrounding dialog (`aria-labelledby`).
 */
@Component({
  selector: 'ui-sheet',
  templateUrl: './sheet.html',
  styleUrl: './sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-presentation]': 'presentation' },
})
export class UiSheet {
  readonly heading = input.required<string>();
  readonly description = input<string>();

  protected readonly actions = contentChild(UiSheetActions);
  protected readonly headingId = `ui-sheet-heading-${nextId++}`;
  protected readonly presentation: UiSheetPresentation =
    inject(UiSheetRef, { optional: true })?.presentation ?? 'sheet';

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      host.closest('dialog, [role="dialog"]')?.setAttribute('aria-labelledby', this.headingId);
    });
  }
}
