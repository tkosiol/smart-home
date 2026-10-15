import {
  CdkDrag,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
  type CdkDragDrop,
} from '@angular/cdk/drag-drop';
import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  Injector,
  TemplateRef,
  afterNextRender,
  contentChild,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { UiAnnouncer } from '../announcer/announcer';
import { UiIconButton } from '../button/icon-button';

/** A row of `ui-reorder-list`; `label` names its drag handle ("Status verschieben"). */
export interface UiReorderItem {
  readonly id: string;
  readonly label: string;
}

export interface UiReorderRowContext<T> {
  readonly $implicit: T;
  readonly index: number;
}

/**
 * Marks the template rendered for each row: `<ng-template [uiReorderRow]="items" let-item>`.
 * The items are passed again only to type the template's context.
 */
@Directive({ selector: 'ng-template[uiReorderRow]' })
export class UiReorderRow<T extends UiReorderItem> {
  readonly uiReorderRow = input.required<readonly T[]>();

  static ngTemplateContextGuard<T extends UiReorderItem>(
    _directive: UiReorderRow<T>,
    context: unknown,
  ): context is UiReorderRowContext<T> {
    return typeof context === 'object' && context !== null;
  }
}

/**
 * A list whose rows are reordered by dragging their handle or, with the handle focused, by the
 * arrow keys (spec 3.5). Every move emits `reordered` with the ids in their new order and is
 * announced to screen readers; the list keeps the new order itself until `items` changes.
 */
@Component({
  selector: 'ui-reorder-list',
  imports: [CdkDropList, CdkDrag, CdkDragHandle, NgTemplateOutlet, UiIconButton],
  templateUrl: './reorder-list.html',
  styleUrl: './reorder-list.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiReorderList<T extends UiReorderItem> {
  readonly items = input.required<readonly T[]>();
  readonly reordered = output<string[]>();

  protected readonly row = contentChild.required(UiReorderRow, { read: TemplateRef });
  protected readonly order = linkedSignal<readonly T[]>(() => this.items());

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly announcer = inject(UiAnnouncer);
  private readonly transloco = inject(TranslocoService);

  protected drop(event: CdkDragDrop<unknown>): void {
    this.move(event.previousIndex, event.currentIndex);
  }

  protected keydown(event: KeyboardEvent, index: number): void {
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    const target = index + delta;
    if (delta === 0 || target < 0 || target >= this.order().length) return;
    event.preventDefault();
    this.move(index, target);
  }

  private move(from: number, to: number): void {
    if (from === to) return;
    const list = [...this.order()];
    moveItemInArray(list, from, to);
    this.order.set(list);
    this.reordered.emit(list.map((item) => item.id));
    const moved = list[to]!;
    void this.announcer.announce(
      this.transloco.translate('ui.reorderList.moved', {
        label: moved.label,
        position: to + 1,
        count: list.length,
      }),
      'polite',
    );
    // Moving a row moves its DOM node, which drops keyboard focus; put it back on the handle.
    afterNextRender(
      () => {
        this.host.nativeElement
          .querySelector<HTMLElement>(`[data-id="${CSS.escape(moved.id)}"] .handle button`)
          ?.focus();
      },
      { injector: this.injector },
    );
  }
}
