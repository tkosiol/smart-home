import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  booleanAttribute,
  computed,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { UiIcon } from '../icon/icon';
import type { UiOption } from '../option';
import { nextIndex } from '../roving-index';

/** A chip option; `count` shows how many entries the option stands for ("Kritisch 2"). */
export interface UiChipOption<T extends string> extends UiOption<T> {
  readonly count?: number;
}

/** Which edges of the row hide more chips; the styles fade them. */
type Fade = 'none' | 'left' | 'right' | 'both';

/**
 * Filter chips (spec 4.2) as a native listbox of buttons, without Material: tonal when unselected,
 * secondary-container with a check mark when selected. Bind the selection with `[(selected)]`
 * (written in the order of the options); `multiple` (default) lets several chips be selected at
 * once, a single choice can only be changed, not emptied. The row never wraps: where the chips
 * are wider than the row, it scrolls sideways (hidden scrollbar, snapping, faded edges), and the
 * arrow keys move the focus along it (Home and End jump); Space or Enter choose.
 */
@Component({
  selector: 'ui-chip-set',
  imports: [UiIcon],
  templateUrl: './chip-set.html',
  styleUrl: './chip-set.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-fade]': 'fade()' },
})
export class UiChipSet<T extends string> {
  readonly options = input.required<readonly UiChipOption<T>[]>();
  readonly selected = model<readonly T[]>([]);
  readonly label = input.required<string>();
  readonly multiple = input(true, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });

  private readonly row = viewChild.required<ElementRef<HTMLElement>>('row');
  /** The chip focused last, which Tab returns to (roving tabindex). */
  private readonly focused = signal<number | null>(null);
  protected readonly fade = signal<Fade>('none');

  /** The chip in the tab order: the one focused last, else the first selected one, else the first. */
  protected readonly tabbable = computed(() => {
    const options = this.options();
    const focused = this.focused();
    if (focused !== null && focused < options.length) return focused;
    const selected = this.selected();
    return Math.max(
      options.findIndex((option) => selected.includes(option.value)),
      0,
    );
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const resize = new ResizeObserver(() => this.measure());
      resize.observe(this.row().nativeElement);
      destroyRef.onDestroy(() => resize.disconnect());
    });
    // Other chips, or a check mark appearing, change the content width of the row.
    afterRenderEffect(() => {
      this.options();
      this.selected();
      this.measure();
    });
  }

  protected isSelected(value: T): boolean {
    return this.selected().includes(value);
  }

  protected toggle(value: T, index: number, event: Event): void {
    this.focused.set(index);
    if (this.multiple()) {
      const next = new Set(this.selected());
      if (next.has(value)) next.delete(value);
      else next.add(value);
      this.selected.set(
        this.options()
          .filter((option) => next.has(option.value))
          .map((option) => option.value),
      );
    } else {
      this.selected.set([value]);
    }
    // A chip tapped at a faded edge comes fully into view (jsdom has no scrollIntoView).
    (event.currentTarget as HTMLElement | null)?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
    });
  }

  protected onFocus(index: number): void {
    this.focused.set(index);
  }

  /** Arrow keys move the focus along the row, wrapping around; Home and End jump to its ends. */
  protected onKeydown(event: KeyboardEvent, index: number): void {
    const next = nextIndex(event.key, index, this.options().length, this.isRightToLeft());
    if (next === undefined) return;
    event.preventDefault();
    this.chips()[next]?.focus();
  }

  /** Reads the scroll position to fade the edges that hide more chips. */
  protected measure(): void {
    const row = this.row().nativeElement;
    const hidden = Math.max(0, row.scrollWidth - row.clientWidth);
    // `scrollLeft` runs from 0 to -hidden in right-to-left writing; one pixel of slack for fractions.
    const hiddenLeft = this.isRightToLeft() ? hidden + row.scrollLeft : row.scrollLeft;
    const left = hiddenLeft > 1;
    const right = hidden - hiddenLeft > 1;
    this.fade.set(left && right ? 'both' : left ? 'left' : right ? 'right' : 'none');
  }

  private chips(): HTMLButtonElement[] {
    return Array.from(this.row().nativeElement.querySelectorAll<HTMLButtonElement>('.chip'));
  }

  private isRightToLeft(): boolean {
    return getComputedStyle(this.row().nativeElement).direction === 'rtl';
  }
}
