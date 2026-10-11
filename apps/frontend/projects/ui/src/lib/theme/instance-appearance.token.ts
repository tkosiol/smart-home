import { InjectionToken } from '@angular/core';
import { DEFAULT_INSTANCE_APPEARANCE, type InstanceAppearance } from '@smart/contracts';

/** Instance default appearance; stage 3c feeds it from the runtime config.json. */
export const INSTANCE_APPEARANCE = new InjectionToken<InstanceAppearance>('INSTANCE_APPEARANCE', {
  providedIn: 'root',
  factory: () => DEFAULT_INSTANCE_APPEARANCE,
});
