import type { Provider } from '@angular/core';
import { provideFeature } from '../../core/features';

/** Registers the devices' overview cards. The card loads lazily: no page code at startup. */
export function provideDevicesFeature(): Provider {
  return provideFeature({
    overviewCards: [() => import('./devices-overview').then((m) => m.DevicesOverview)],
  });
}
