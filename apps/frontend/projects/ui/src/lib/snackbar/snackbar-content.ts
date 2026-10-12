import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import {
  MAT_SNACK_BAR_DATA,
  MatSnackBarAction,
  MatSnackBarActions,
  MatSnackBarLabel,
  MatSnackBarRef,
} from '@angular/material/snack-bar';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIconButton } from '../button/icon-button';

export interface UiSnackbarData {
  readonly message: string;
  readonly action?: string;
}

/** Content of `UiSnackbar`: the message, and for messages with an action also a close button. */
@Component({
  selector: 'ui-snackbar-content',
  imports: [
    MatButton,
    MatSnackBarAction,
    MatSnackBarActions,
    MatSnackBarLabel,
    TranslocoPipe,
    UiIconButton,
  ],
  templateUrl: './snackbar-content.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiSnackbarContent {
  private readonly ref = inject(MatSnackBarRef);
  protected readonly data = inject<UiSnackbarData>(MAT_SNACK_BAR_DATA);

  protected act(): void {
    this.ref.dismissWithAction();
  }

  protected close(): void {
    this.ref.dismiss();
  }
}
