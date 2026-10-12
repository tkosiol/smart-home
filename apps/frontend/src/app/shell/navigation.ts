import { marker } from '@jsverse/transloco-keys-manager/marker';
import type { IconName } from '@smart/ui';

export interface MainDestination {
  readonly route: string;
  readonly labelKey: string;
  readonly icon: IconName;
  readonly exact?: boolean;
}

/** The four main destinations; labels are root translation keys. */
export const MAIN_DESTINATIONS: readonly MainDestination[] = [
  { route: '/', labelKey: marker('app.nav.overview'), icon: 'home', exact: true },
  { route: '/raeume', labelKey: marker('app.nav.rooms'), icon: 'meeting_room' },
  { route: '/geraete', labelKey: marker('app.nav.devices'), icon: 'devices' },
  { route: '/mehr', labelKey: marker('app.nav.more'), icon: 'more_horiz' },
];
