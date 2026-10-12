import { ChangeDetectionStrategy, Component, computed, model } from '@angular/core';
import { TranslocoPipe, translateSignal } from '@jsverse/transloco';
import {
  CORE_COLOR_IDS,
  THEME_VARIANTS,
  type CoreColorId,
  type ThemeColors,
  type ThemeVariant,
} from '@smart/contracts';
import { deriveKeyColors } from '@smart/theme';
import { UiColorField } from '../color-field/color-field';
import { UiSection } from '../layout/section/section';
import { UiStack } from '../layout/stack/stack';
import { UiSelect } from '../select/select';
import { UiSwitch } from '../switch/switch';
import {
  CORE_COLOR_KEYS,
  SEED_SUGGESTIONS,
  VARIANT_KEYS,
  VARIANT_WITH_COLOR_MATCH_KEY,
} from './theme-editor-labels';
import { translatedOptions } from './translated-options';

type Overrides = ThemeColors['coreOverrides'];

const without = (overrides: Overrides, id: CoreColorId): Overrides =>
  Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== id)) as Overrides;

/** Color part of the theme editor (spec 4.4): seed, variant, color match and key color overrides. */
@Component({
  selector: 'ui-theme-colors',
  imports: [TranslocoPipe, UiColorField, UiSection, UiSelect, UiStack, UiSwitch],
  templateUrl: './theme-colors.html',
  styleUrl: './theme-colors.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiThemeColors {
  readonly colors = model.required<ThemeColors>();

  protected readonly suggestions = SEED_SUGGESTIONS;
  protected readonly suggestionLabels = translateSignal(
    SEED_SUGGESTIONS.map((suggestion) => suggestion.labelKey),
  );
  protected readonly variantOptions = translatedOptions(THEME_VARIANTS, VARIANT_KEYS);
  private readonly colorMatchHint = translateSignal(VARIANT_WITH_COLOR_MATCH_KEY);
  protected readonly variantHint = computed(() =>
    this.colors().colorMatch ? this.colorMatchHint() : undefined,
  );
  protected readonly coreColorIds = CORE_COLOR_IDS;
  protected readonly coreColorNames = translateSignal(
    CORE_COLOR_IDS.map((id) => CORE_COLOR_KEYS[id]),
  );
  /** Overrides show their own value; all others are derived from the current source (spec 4.4). */
  protected readonly keyColors = computed(() => deriveKeyColors(this.colors()));

  protected setSeed(seed: string): void {
    this.colors.update((colors) => ({ ...colors, seed }));
  }

  protected setVariant(variant: ThemeVariant | undefined): void {
    if (variant) this.colors.update((colors) => ({ ...colors, variant }));
  }

  protected setColorMatch(colorMatch: boolean): void {
    this.colors.update((colors) => ({ ...colors, colorMatch }));
  }

  /** An override starts at the currently derived value, so switching it on changes nothing yet. */
  protected setOverridden(id: CoreColorId, overridden: boolean): void {
    const derived = this.keyColors()[id].hex;
    this.colors.update((colors) => ({
      ...colors,
      coreOverrides: overridden
        ? { ...colors.coreOverrides, [id]: derived }
        : without(colors.coreOverrides, id),
    }));
  }

  protected setOverride(id: CoreColorId, hex: string): void {
    this.colors.update((colors) => ({
      ...colors,
      coreOverrides: { ...colors.coreOverrides, [id]: hex },
    }));
  }
}
