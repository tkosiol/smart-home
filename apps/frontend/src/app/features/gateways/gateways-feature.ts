import type { Provider } from '@angular/core';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import { provideFeature } from '../../core/features';

/**
 * Adds the gateways to the "More" page and the block "Gateway" (hidden by default) to the
 * overview. Metadata only, so no page code loads at startup.
 */
export function provideGatewaysFeature(): Provider {
  return provideFeature({
    moreEntries: [
      {
        id: 'gateways',
        labelKey: marker('app.more.gateways'),
        icon: 'router',
        group: 'household',
        route: '/mehr/gateways',
        order: 40,
        minRole: 'owner',
      },
    ],
    overviewBlocks: [
      {
        id: 'gateway',
        labelKey: marker('app.overview.blocks.gateway.label'),
        descriptionKey: marker('app.overview.blocks.gateway.description'),
        icon: 'router',
        defaultVisible: false,
        defaultOrder: 30,
        minRole: 'owner',
        component: () => import('./gateway-block').then((m) => m.GatewayBlock),
      },
    ],
  });
}
