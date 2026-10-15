import { marker } from '@jsverse/transloco-keys-manager/marker';
import type { AttentionItem, AttentionKind } from '@smart/contracts';
import type { UiStatusEntryTone } from '@smart/ui';
import type { IconName } from '@smart/ui/shell';
import type { AttentionGroup } from './attention-model';

/** Where an entry leads. The page turns it into a route, because it depends on the user's role. */
export type EntryTarget =
  | { readonly kind: 'device'; readonly deviceId: string }
  /** The gateways page (owners). */
  | { readonly kind: 'gateways' }
  /** The devices page, where new hardware is added (owners). */
  | { readonly kind: 'devices' }
  /** "All notices", preselected to one kind. */
  | { readonly kind: 'group'; readonly attentionKind: AttentionKind };

/** One row of the status hero: the group of notices, or the one notice a group holds. */
export interface EntryView {
  readonly id: string;
  readonly icon: IconName;
  readonly tone: UiStatusEntryTone;
  readonly critical: boolean;
  /** Translation keys (the scope `attention`) and their parameters; the template translates. */
  readonly titleKey: string;
  readonly titleParams: Readonly<Record<string, unknown>>;
  readonly subtitle:
    | { readonly key: string; readonly params: Readonly<Record<string, unknown>> }
    | { readonly text: string }
    | null;
  /** "18 %", for one notice that has a value. */
  readonly value: string | null;
  readonly target: EntryTarget;
}

interface KindView {
  readonly icon: IconName;
  /** The icon container of a notice that is not critical; critical ones use `error` (rule 6). */
  readonly tone: UiStatusEntryTone;
  readonly one: string;
  readonly many: string;
}

// Literal keys, so the key check finds them (the kind is only known at run time).
const KINDS: Record<AttentionKind, KindView> = {
  gateway_offline: {
    icon: 'router',
    tone: 'error',
    one: marker('app.attention.kind.gateway_offline.one'),
    many: marker('app.attention.kind.gateway_offline.many'),
  },
  device_silent: {
    icon: 'wifi_off',
    tone: 'error',
    one: marker('app.attention.kind.device_silent.one'),
    many: marker('app.attention.kind.device_silent.many'),
  },
  soil_dry: {
    icon: 'water_drop',
    tone: 'dry-container',
    one: marker('app.attention.kind.soil_dry.one'),
    many: marker('app.attention.kind.soil_dry.many'),
  },
  soil_wet: {
    icon: 'water_drop',
    tone: 'wet-container',
    one: marker('app.attention.kind.soil_wet.one'),
    many: marker('app.attention.kind.soil_wet.many'),
  },
  battery_low: {
    icon: 'battery_alert',
    tone: 'warning-container',
    one: marker('app.attention.kind.battery_low.one'),
    many: marker('app.attention.kind.battery_low.many'),
  },
  contact_open: {
    icon: 'door_open',
    tone: 'secondary-container',
    one: marker('app.attention.kind.contact_open.one'),
    many: marker('app.attention.kind.contact_open.many'),
  },
  hardware_new: {
    icon: 'devices',
    tone: 'secondary-container',
    one: marker('app.attention.kind.hardware_new.one'),
    many: marker('app.attention.kind.hardware_new.many'),
  },
  cert_expiring: {
    icon: 'schedule',
    tone: 'secondary-container',
    one: marker('app.attention.kind.cert_expiring.one'),
    many: marker('app.attention.kind.cert_expiring.many'),
  },
};

/** A kind this app does not know (a module that is newer than the app): shown with its name only. */
const UNKNOWN: KindView = {
  icon: 'info',
  tone: 'secondary-container',
  one: marker('app.attention.kind.unknown.one'),
  many: marker('app.attention.kind.unknown.many'),
};

const CERT_KEYS = {
  certificate: marker('app.attention.kind.cert_expiring.one'),
  certificateExpired: marker('app.attention.kind.cert_expiring.expired'),
  crl: marker('app.attention.kind.cert_expiring.crl'),
  crlExpired: marker('app.attention.kind.cert_expiring.crlExpired'),
} as const;

const SUBTITLE_KEYS = {
  devices: marker('app.attention.subtitle.devices'),
  devicesOne: marker('app.attention.subtitle.devicesOne'),
} as const;

const NBSP = String.fromCharCode(0xa0);

/** "18 %" in the language of the user; no value, no text. */
export function valueText(item: AttentionItem, locale: string): string | null {
  if (item.value === undefined) return null;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(item.value);
  return item.unit ? `${number}${NBSP}${item.unit}` : number;
}

function target(group: AttentionGroup): EntryTarget {
  const [only] = group.items;
  if (group.items.length > 1 || !only) return { kind: 'group', attentionKind: group.kind };
  if (only.deviceId) return { kind: 'device', deviceId: only.deviceId };
  if (group.kind === 'hardware_new') return { kind: 'devices' };
  if (only.gatewayId) return { kind: 'gateways' };
  return { kind: 'group', attentionKind: group.kind };
}

function singleTitleKey(view: KindView, item: AttentionItem): string {
  if (item.kind !== 'cert_expiring') return view.one;
  const expired = item.params['expired'] === true;
  if (item.params['subject'] === 'crl') return expired ? CERT_KEYS.crlExpired : CERT_KEYS.crl;
  return expired ? CERT_KEYS.certificateExpired : CERT_KEYS.certificate;
}

function singleSubtitle(item: AttentionItem): EntryView['subtitle'] {
  const affected = item.params['affectedDevices'];
  if (item.kind !== 'gateway_offline' || typeof affected !== 'number' || affected < 1) return null;
  return {
    key: affected === 1 ? SUBTITLE_KEYS.devicesOne : SUBTITLE_KEYS.devices,
    params: { count: affected },
  };
}

/**
 * One row of the hero (spec 4.1, rules 2 and 6): a group of several notices reads "5 Pflanzen zu
 * trocken" with the names beneath; a group of one shows the notice itself ("Ficus ist zu trocken",
 * "18 %"). Critical rows have the strong `error` container and no value (the hero labels them).
 */
export function entryOf(group: AttentionGroup, locale: string): EntryView {
  const view = KINDS[group.kind] ?? UNKNOWN;
  const critical = group.severity === 'critical';
  const [only] = group.items;
  const common = {
    id: group.items[0]?.id ?? group.kind,
    icon: view.icon,
    tone: critical ? ('error' as const) : view.tone,
    critical,
    target: target(group),
  };
  if (group.items.length === 1 && only) {
    return {
      ...common,
      titleKey: singleTitleKey(view, only),
      titleParams: { name: only.name },
      subtitle: singleSubtitle(only),
      value: critical ? null : valueText(only, locale),
    };
  }
  return {
    ...common,
    titleKey: view.many,
    titleParams: { count: group.items.length },
    subtitle: { text: group.items.map((item) => item.name).join(', ') },
    value: null,
  };
}
