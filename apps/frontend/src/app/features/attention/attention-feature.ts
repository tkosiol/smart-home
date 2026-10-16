import type { Provider } from '@angular/core';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import { provideFeature } from '../../core/features';

/** Registers the overview's status block. It loads lazily: no page code at startup. */
export function provideAttentionFeature(): Provider {
  return provideFeature({
    overviewBlocks: [
      {
        id: 'status',
        labelKey: marker('app.overview.blocks.status.label'),
        descriptionKey: marker('app.overview.blocks.status.description'),
        icon: 'notifications',
        defaultVisible: true,
        defaultOrder: 10,
        // A critical notice is shown whatever the layout says (spec 4.1, rule 7).
        surfaceWhenHidden: true,
        // Over both columns from medium up (spec 3.7).
        span: 'full',
        component: () => import('./status-block').then((m) => m.StatusBlock),
      },
    ],
  });
}
