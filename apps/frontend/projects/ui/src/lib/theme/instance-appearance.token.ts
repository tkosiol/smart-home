import { InjectionToken } from '@angular/core';
import { DEFAULT_INSTANCE_APPEARANCE, type InstanceAppearance } from '@smart/contracts';

/** Instance default of this installation: config.json if the hoster set one, else the build default. */
export const INSTANCE_APPEARANCE = new InjectionToken<InstanceAppearance>('INSTANCE_APPEARANCE', {
  providedIn: 'root',
  factory: () => DEFAULT_INSTANCE_APPEARANCE,
});
