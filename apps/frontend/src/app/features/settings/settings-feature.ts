import type { Provider } from '@angular/core';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import { provideFeature } from '../../core/features';

/** Adds the settings to the "More" page. Metadata only, so no page code loads at startup. */
export function provideSettingsFeature(): Provider {
  return provideFeature({
    moreEntries: [
      {
        id: 'settings',
        labelKey: marker('app.more.settings'),
        icon: 'settings',
        route: '/mehr/einstellungen',
        order: 90,
      },
    ],
  });
}
