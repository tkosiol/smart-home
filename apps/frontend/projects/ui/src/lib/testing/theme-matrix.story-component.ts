import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  TemplateRef,
  computed,
  contentChild,
  input,
} from '@angular/core';
import { MATRIX_SEEDS, themeMatrixCells } from './theme-matrix';

/** Marks the template a `ui-theme-matrix` renders once per combination. */
@Directive({ selector: 'ng-template[uiMatrixCell]' })
export class UiMatrixCell {}

/**
 * Storybook only: renders its cell template in the twelve combinations of spec 2.7 (two seeds ×
 * light/dark × standard/medium/high contrast) side by side. Each cell carries the theme variables
 * of its combination inline, so one story shows, and axe checks, every combination at once.
 */
@Component({
  selector: 'ui-theme-matrix',
  imports: [NgTemplateOutlet],
  templateUrl: './theme-matrix.story-component.html',
  styleUrl: './theme-matrix.story-component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeMatrixStoryComponent {
  readonly seeds = input<readonly string[]>(MATRIX_SEEDS);

  protected readonly cell = contentChild.required(UiMatrixCell, { read: TemplateRef });
  protected readonly cells = computed(() => themeMatrixCells(this.seeds()));
}
