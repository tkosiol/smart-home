import { InjectionToken } from '@angular/core';

/** The `data` passed to `UiBottomSheet.open`, for the content component: `inject<D>(UI_SHEET_DATA)`. */
export const UI_SHEET_DATA = new InjectionToken<unknown>('UI_SHEET_DATA');

/** How the content is shown: a bottom sheet (compact windows) or a dialog (medium up). */
export type UiSheetPresentation = 'sheet' | 'dialog';

/**
 * Handle of an open sheet or dialog for its content component: `inject(UiSheetRef)`. Closing with
 * a result resolves the `open` promise with it; closing without one, Escape or the backdrop
 * resolve `undefined`.
 */
export abstract class UiSheetRef<R = unknown> {
  abstract readonly presentation: UiSheetPresentation;
  abstract close(result?: R): void;
}
