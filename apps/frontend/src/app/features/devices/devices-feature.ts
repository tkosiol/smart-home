import type { Provider } from '@angular/core';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import { provideFeature } from '../../core/features';

/** Registers the overview block "Geräte". It loads lazily: no page code at startup. */
export function provideDevicesFeature(): Provider {
  return provideFeature({
    overviewBlocks: [
      {
        id: 'devices',
        labelKey: marker('app.overview.blocks.devices.label'),
        descriptionKey: marker('app.overview.blocks.devices.description'),
        icon: 'devices',
        defaultVisible: true,
        defaultOrder: 20,
        component: () => import('./devices-block').then((m) => m.DevicesBlock),
      },
    ],
  });
}
