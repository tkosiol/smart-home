import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  inject,
  input,
  model,
} from '@angular/core';
import { UiIcon } from '../icon/icon';
import type { UiOption } from '../option';
import { nextIndex } from '../roving-index';

/**
 * Single choice among few options as an M3 Expressive connected button group (spec 4.2), a native
 * radio group of buttons without Material; bind with `[(value)]`. Only the chosen segment is in
 * the tab order; the arrow keys move the choice along the group (Home and End jump to its ends).
 */
@Component({
  selector: 'ui-segmented-button',
  imports: [UiIcon],
  templateUrl: './segmented-button.html',
  styleUrl: './segmented-button.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-full-width]': "fullWidth() ? '' : null" },
})
export class UiSegmentedButton<T extends string> {
  readonly options = input.required<readonly UiOption<T>[]>();
  readonly value = model<T>();
  readonly label = input.required<string>();
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Stretches the group across its container, the segments sharing the width evenly. */
  readonly fullWidth = input(false, { transform: booleanAttribute });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The segment in the tab order: the chosen one, else the first (radio group pattern). */
  protected readonly tabbable = computed(() =>
    Math.max(
      this.options().findIndex((option) => option.value === this.value()),
      0,
    ),
  );

  protected select(value: T): void {
    this.value.set(value);
  }

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const rtl = getComputedStyle(this.host.nativeElement).direction === 'rtl';
    const next = nextIndex(event.key, index, this.options().length, rtl, true);
    if (next === undefined) return;
    event.preventDefault();
    this.select(this.options()[next]!.value);
    this.host.nativeElement.querySelectorAll<HTMLButtonElement>('.segment')[next]?.focus();
  }
}
