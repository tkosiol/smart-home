import type { Provider } from '@angular/core';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import { provideFeature } from '../../core/features';

/** Adds household and members to the "More" page. Metadata only, so no page code loads at startup. */
export function provideHouseholdsFeature(): Provider {
  return provideFeature({
    moreEntries: [
      {
        id: 'household',
        labelKey: marker('app.more.household'),
        icon: 'home',
        group: 'household',
        route: '/mehr/haushalt',
        order: 30,
        minRole: 'owner',
      },
      {
        id: 'members',
        labelKey: marker('app.more.members'),
        icon: 'group',
        group: 'household',
        route: '/mehr/mitglieder',
        order: 35,
        minRole: 'viewer',
      },
    ],
  });
}
