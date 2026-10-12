import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { TRANSLOCO_SCOPE, TranslocoPipe, translateSignal } from '@jsverse/transloco';
import {
  DEFAULT_PERSONAL_APPEARANCE,
  THEME_CONTRASTS,
  THEME_FONTS,
  THEME_MODES,
  THEME_SHAPES,
  type InstanceAppearance,
  type PersonalAppearance,
  type ThemeColors,
  type ThemeContrast,
  type ThemeFont,
  type ThemeMode,
  type ThemeShape,
} from '@smart/contracts';
import { UiButton } from '../button/button';
import { UiSection } from '../layout/section/section';
import { UiStack } from '../layout/stack/stack';
import { UiSegmentedButton } from '../segmented-button/segmented-button';
import { UiSelect } from '../select/select';
import { UiSwitch } from '../switch/switch';
import { UiThemeColors } from './theme-colors';
import {
  CONTRAST_KEYS,
  CONTRAST_SYSTEM_HINT_KEY,
  FONT_KEYS,
  MODE_KEYS,
  SHAPE_KEYS,
} from './theme-editor-labels';
import { translatedOptions } from './translated-options';

export type UiThemeEditorMode = 'personal' | 'instance';

/**
 * Theme editor (spec 2, 4.2): `personal` edits mode, contrast and optional own colors;
 * `instance` edits the installation's colors, shapes and font. Changes are written to the models
 * at once; the host applies and stores them (live) and handles `resetRequested`.
 */
@Component({
  selector: 'ui-theme-editor',
  imports: [
    TranslocoPipe,
    UiButton,
    UiSection,
    UiSegmentedButton,
    UiSelect,
    UiStack,
    UiSwitch,
    UiThemeColors,
  ],
  templateUrl: './theme-editor.html',
  styleUrl: './theme-editor.scss',
  // The editor only uses the library's root texts (`ui.*`). Inside a page with a lazy Transloco
  // scope, `translateSignal` would otherwise look them up in that scope only and miss them.
  providers: [{ provide: TRANSLOCO_SCOPE, useValue: null }],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiThemeEditor {
  readonly mode = input.required<UiThemeEditorMode>();
  readonly instance = model.required<InstanceAppearance>();
  readonly personal = model<PersonalAppearance>(DEFAULT_PERSONAL_APPEARANCE);
  /** "Reset to default" was pressed; named so it does not clash with the native `reset` DOM event. */
  readonly resetRequested = output<void>();

  protected readonly modeOptions = translatedOptions(THEME_MODES, MODE_KEYS);
  protected readonly contrastOptions = translatedOptions(THEME_CONTRASTS, CONTRAST_KEYS);
  protected readonly shapeOptions = translatedOptions(THEME_SHAPES, SHAPE_KEYS);
  protected readonly fontOptions = translatedOptions(THEME_FONTS, FONT_KEYS);
  private readonly contrastSystemHint = translateSignal(CONTRAST_SYSTEM_HINT_KEY);
  protected readonly contrastHint = computed(() =>
    this.personal().contrast === 'system' ? this.contrastSystemHint() : undefined,
  );

  protected setMode(mode: ThemeMode | undefined): void {
    if (mode) this.personal.update((personal) => ({ ...personal, mode }));
  }

  protected setContrast(contrast: ThemeContrast | undefined): void {
    if (contrast) this.personal.update((personal) => ({ ...personal, contrast }));
  }

  /** Own colors start from the installation's colors, so switching them on changes nothing yet. */
  protected setOwnColors(own: boolean): void {
    this.personal.update(({ mode, contrast }) =>
      own ? { mode, contrast, colors: this.instance().colors } : { mode, contrast },
    );
  }

  protected setPersonalColors(colors: ThemeColors): void {
    this.personal.update((personal) => ({ ...personal, colors }));
  }

  protected setInstanceColors(colors: ThemeColors): void {
    this.instance.update((instance) => ({ ...instance, colors }));
  }

  protected setShape(shape: ThemeShape | undefined): void {
    if (shape) this.instance.update((instance) => ({ ...instance, shape }));
  }

  protected setFont(font: ThemeFont | undefined): void {
    if (font) this.instance.update((instance) => ({ ...instance, font }));
  }
}
