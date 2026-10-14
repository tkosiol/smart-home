import { marker } from '@jsverse/transloco-keys-manager/marker';
import type { MoreEntry } from '../../core/features';

/** Planned areas without a page yet; shown as "coming soon" rows (no route). */
export const COMING_SOON_ENTRIES: readonly MoreEntry[] = [
  { id: 'modules', labelKey: marker('app.more.modules'), icon: 'extension', order: 10 },
  {
    id: 'notifications',
    labelKey: marker('app.more.notifications'),
    icon: 'notifications',
    order: 20,
  },
  { id: 'gateways', labelKey: marker('app.more.gateways'), icon: 'router', order: 40 },
];
