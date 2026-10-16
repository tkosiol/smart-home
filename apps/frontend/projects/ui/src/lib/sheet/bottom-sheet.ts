import { BreakpointObserver } from '@angular/cdk/layout';
import {
  ApplicationRef,
  DOCUMENT,
  EnvironmentInjector,
  Injectable,
  Injector,
  createComponent,
  inject,
  type Type,
} from '@angular/core';
import { MEDIUM } from '../adaptive-shell/adaptive-shell';
import { UI_SHEET_DATA, UiSheetRef, type UiSheetPresentation } from './sheet-ref';

/**
 * Opens a content component as a bottom sheet on compact windows and as a dialog from medium
 * windows up (spec 3.5, 3.7). The content injects its `data` with `UI_SHEET_DATA`, closes itself
 * through `UiSheetRef`, and `ui-sheet` gives it the frame (handle, heading, actions).
 *
 * The host is a native `<dialog>` (`UiSheetHost`), loaded on first use, not Material's sheet and
 * dialog: both need CDK's focus trap, whose module esbuild assigns to the initial bundle (it is
 * reachable from Material's button there), which would cost about 9 kB at startup however lazily
 * the sheet itself loads. `showModal()` brings the trap, the inert page and Escape natively.
 */
@Injectable({ providedIn: 'root' })
export class UiBottomSheet {
  private readonly injector = inject(Injector);
  private readonly environment = inject(EnvironmentInjector);
  private readonly appRef = inject(ApplicationRef);
  private readonly document = inject(DOCUMENT);
  private readonly breakpoints = inject(BreakpointObserver);

  private pending: Promise<unknown> | null = null;

  /**
   * Resolves with the content's result, or `undefined` when it was closed without one. One sheet
   * at a time: while one is loading or open, another `open()` returns the promise of that sheet
   * (its `component` and `data` are ignored) and stacks no second dialog.
   */
  open<C, D, R>(component: Type<C>, data: D): Promise<R | undefined> {
    if (this.pending) return this.pending as Promise<R | undefined>;
    const sheet = this.show<C, D, R>(component, data);
    const done = () => (this.pending = null);
    this.pending = sheet;
    sheet.then(done, done);
    return sheet;
  }

  private async show<C, D, R>(component: Type<C>, data: D): Promise<R | undefined> {
    const { UiSheetHost } = await import('./sheet-host');
    const presentation: UiSheetPresentation = this.breakpoints.isMatched(MEDIUM)
      ? 'dialog'
      : 'sheet';
    let result: R | undefined;
    let close: () => void = () => undefined;
    const ref: UiSheetRef<R> = {
      presentation,
      close: (value) => {
        result = value;
        close();
      },
    };
    const host = createComponent(UiSheetHost, {
      environmentInjector: this.environment,
      elementInjector: Injector.create({
        providers: [
          { provide: UI_SHEET_DATA, useValue: data },
          { provide: UiSheetRef, useValue: ref },
        ],
        parent: this.injector,
      }),
    });
    host.setInput('component', component);
    host.setInput('presentation', presentation);
    close = () => host.instance.close();
    return new Promise((resolve) => {
      host.instance.closed.subscribe(() => {
        host.destroy();
        host.location.nativeElement.remove();
        resolve(result);
      });
      this.appRef.attachView(host.hostView);
      this.document.body.appendChild(host.location.nativeElement);
    });
  }
}
