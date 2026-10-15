import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  output,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import type { DeviceKind } from '@smart/contracts';
import { UiIcon } from '../icon/icon';
import type { IconName } from '../icon/icon-codepoints';
import type { UiTone, UiToneName } from '../tone';
import { UiValueDisplay } from '../value-display/value-display';

/** The small pill in the pod's corner: a state in words ("trocken", "An") in a colour family. */
export interface UiDevicePodChip {
  readonly text: string;
  readonly tone: UiToneName;
}

/** A pod's fill: a colour family, or `off` for an unlit lamp (surface-container-highest). */
export type UiDevicePodTone = UiTone | 'off';

/** Spec 2.4: the pod colour per device kind; a lamp is `primary` only while it is on. */
const POD_TONE: Record<DeviceKind, UiTone> = {
  light: 'primary',
  soil: 'tertiary-container',
  climate: 'secondary-container',
  contact: 'secondary-container',
  other: 'surface',
};

/**
 * A device pod (spec 3.1): icon and chip on top, the value large, name and side value below.
 * With a `route` it is a link to the device page; with `pressed` (and no route) it is a switch
 * (`aria-pressed`) that emits `toggled` and ignores presses while `pending`; with neither it is
 * plain content (side values on the device page). `pressed` also colours a lamp pod in link mode.
 * The link or switch is named by its content in reading order ("trocken 24 % Monstera · 22,1 °C");
 * an `aria-label` in another order would break WCAG 2.5.3. The server computes `kind`, the pod
 * never derives it.
 */
@Component({
  selector: 'ui-device-pod',
  imports: [NgTemplateOutlet, RouterLink, UiIcon, UiValueDisplay],
  templateUrl: './device-pod.html',
  styleUrl: './device-pod.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiDevicePod {
  readonly kind = input.required<DeviceKind>();
  readonly icon = input.required<IconName>();
  /** Formatted by the caller, without the unit. */
  readonly value = input.required<string>();
  readonly unit = input<string>();
  /** Name and side value, e.g. "Monstera · 22,1 °C". */
  readonly label = input.required<string>();
  readonly chip = input<UiDevicePodChip | null>(null);
  readonly route = input<string>();
  /** Switch state; `undefined` means the pod is no switch. */
  readonly pressed = input<boolean | undefined>(undefined);
  /** A switch waiting for the device to confirm: dimmed, with a ring, and blocked. */
  readonly pending = input(false, { transform: booleanAttribute });
  readonly toggled = output<void>();

  protected readonly mode = computed<'link' | 'switch' | 'static'>(() => {
    if (this.route()) return 'link';
    return this.pressed() === undefined ? 'static' : 'switch';
  });

  protected readonly tone = computed<UiDevicePodTone>(() => {
    const kind = this.kind();
    if (kind === 'light') return this.pressed() ? 'primary' : 'off';
    return POD_TONE[kind];
  });

  protected toggle(): void {
    if (!this.pending()) this.toggled.emit();
  }
}
