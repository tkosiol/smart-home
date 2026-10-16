import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { DeviceKind } from '@smart/contracts';

/** The hero's fill: a container of a colour family, or the neutral `surface`. */
export type UiDeviceHeroTone =
  'primary-container' | 'secondary-container' | 'tertiary-container' | 'surface';

/**
 * Spec 2.4 for the hero: the container colour of the device kind. A lamp takes primary-container
 * (the hero knows no on/off state), soil tertiary, climate and contact secondary, other the
 * neutral surface.
 */
const HERO_TONE: Record<DeviceKind, UiDeviceHeroTone> = {
  light: 'primary-container',
  soil: 'tertiary-container',
  climate: 'secondary-container',
  contact: 'secondary-container',
  other: 'surface',
};

/**
 * The hero card of the device page (spec 3.3): the main value in the colour of the device kind.
 * The top row holds the `label` ("Bodenfeuchte", a section label in capitals) and the projected
 * `ui-status-chip`; below follow the projected content, usually a `ui-value-display size="hero"`
 * and a `ui-progress-band`, and the `note` ("Aktualisiert vor 3 Minuten"). The texts inherit the
 * card's on-colour. The server computes `kind`, the hero never derives it.
 */
@Component({
  selector: 'ui-device-hero',
  templateUrl: './device-hero.html',
  styleUrl: './device-hero.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tone]': 'tone()' },
})
export class UiDeviceHero {
  readonly kind = input.required<DeviceKind>();
  /** The name of the main value, translated by the caller. */
  readonly label = input.required<string>();
  /** The line at the bottom: when the value was last updated. */
  readonly note = input<string>();

  protected readonly tone = computed(() => HERO_TONE[this.kind()]);
}
