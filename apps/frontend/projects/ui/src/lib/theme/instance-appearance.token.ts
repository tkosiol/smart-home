import { InjectionToken } from '@angular/core';
import { DEFAULT_INSTANCE_APPEARANCE, type InstanceAppearance } from '@smart/contracts';

/** Instance default of this installation: config.json if the hoster set one, else the build default. */
export const INSTANCE_APPEARANCE = new InjectionToken<InstanceAppearance>('INSTANCE_APPEARANCE', {
  providedIn: 'root',
  factory: () => DEFAULT_INSTANCE_APPEARANCE,
});

/**
 * Whether a browser-stored instance theme may override the default (spec 4.5): only while the
 * instance appearance editor is enabled, so a forgotten local edit cannot hide the hoster's default.
 */
export const STORED_INSTANCE_ALLOWED = new InjectionToken<boolean>('STORED_INSTANCE_ALLOWED', {
  providedIn: 'root',
  factory: () => false,
});
