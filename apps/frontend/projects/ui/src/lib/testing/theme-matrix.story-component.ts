import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  TemplateRef,
  contentChild,
} from '@angular/core';
import { themeMatrixCells, type ThemeMatrixCell } from './theme-matrix';

/**
 * Marks the template a `ui-theme-matrix` renders once per combination; the combination is the
 * template's implicit context (`let-cell`), e.g. to keep landmark names unique across cells.
 */
@Directive({ selector: 'ng-template[uiMatrixCell]' })
export class UiMatrixCell {
  static ngTemplateContextGuard(
    _directive: UiMatrixCell,
    context: unknown,
  ): context is { $implicit: ThemeMatrixCell } {
    return typeof context === 'object' && context !== null;
  }
}

/**
 * Storybook only: renders its cell template twice side by side, in light and in dark (default
 * seed, standard contrast, default font). Each cell carries the theme variables of its mode
 * inline, so one story shows, and axe checks, both at once.
 */
@Component({
  selector: 'ui-theme-matrix',
  imports: [NgTemplateOutlet],
  templateUrl: './theme-matrix.story-component.html',
  styleUrl: './theme-matrix.story-component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeMatrixStoryComponent {
  protected readonly cell = contentChild.required(UiMatrixCell, { read: TemplateRef });
  protected readonly cells = themeMatrixCells();
}
