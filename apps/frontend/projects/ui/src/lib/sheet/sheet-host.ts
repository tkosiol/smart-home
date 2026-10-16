import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
  type Type,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';
import type { UiSheetPresentation } from './sheet-ref';

/**
 * Loaded by `UiBottomSheet` on first use: a native `<dialog>` that shows the content component
 * as a bottom sheet or as a centred dialog. `showModal()` gives the focus trap, the inert page
 * behind it, Escape and the focus restore on close; a tap on the backdrop and a navigation close
 * it too. The data and the `UiSheetRef` reach the content through the host's injector.
 */
@Component({
  selector: 'ui-sheet-host',
  imports: [NgComponentOutlet],
  templateUrl: './sheet-host.html',
  styleUrl: './sheet-host.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Escape is handled here as well as by the browser, so test DOMs without the dialog API agree.
  host: {
    '(pointerdown)': 'onPointerDown($event)',
    '(click)': 'onClick($event)',
    '(keydown.escape)': 'close()',
  },
})
export class UiSheetHost {
  readonly component = input.required<Type<unknown>>();
  readonly presentation = input.required<UiSheetPresentation>();
  /** Fires once, after the dialog has closed for whatever reason. */
  readonly closed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private closing = false;
  /** Where the press of the current click started. */
  private pressed: EventTarget | null = null;

  constructor() {
    afterNextRender(() => this.show());
    inject(Router, { optional: true })
      ?.events.pipe(
        filter((event) => event instanceof NavigationStart),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.close());
    inject(DestroyRef).onDestroy(() => this.close());
  }

  /** Closes the dialog; the `close` event then reports it once. */
  close(): void {
    if (this.closing) return;
    this.closing = true;
    const dialog = this.dialog().nativeElement;
    if (typeof dialog.close === 'function' && dialog.open) {
      dialog.close();
    } else {
      // Without the dialog API (test DOMs) the attribute and the event stand in for it.
      dialog.removeAttribute('open');
      dialog.dispatchEvent(new Event('close'));
    }
  }

  protected onClosed(): void {
    this.closing = true;
    this.closed.emit();
  }

  protected onPointerDown(event: PointerEvent): void {
    this.pressed = event.target;
  }

  /**
   * Only a click that starts and ends on the backdrop closes: a drag or a text selection that
   * begins inside the sheet and ends outside it also fires its click on the dialog element.
   */
  protected onClick(event: MouseEvent): void {
    const dialog = this.dialog().nativeElement;
    const startedOnBackdrop = this.pressed === dialog;
    this.pressed = null;
    if (event.target === dialog && startedOnBackdrop) this.close();
  }

  private show(): void {
    const dialog = this.dialog().nativeElement;
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }
}
