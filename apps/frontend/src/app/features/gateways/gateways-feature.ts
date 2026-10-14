import type { Provider } from '@angular/core';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import { provideFeature } from '../../core/features';

/** Adds the gateways to the "More" page. Metadata only, so no page code loads at startup. */
export function provideGatewaysFeature(): Provider {
  return provideFeature({
    moreEntries: [
      {
        id: 'gateways',
        labelKey: marker('app.more.gateways'),
        icon: 'router',
        route: '/mehr/gateways',
        order: 40,
        minRole: 'owner',
      },
    ],
  });
}
