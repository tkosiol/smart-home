import { marker } from '@jsverse/transloco-keys-manager/marker';
import {
  ATTENTION_KINDS,
  ATTENTION_SEVERITIES,
  type AttentionItem,
  type AttentionKind,
  type AttentionSeverity,
} from '@smart/contracts';
import { entryOf, valueText, type EntryTarget, type EntryView } from './attention-entries';
import { groupAttention } from './attention-model';

/** "All" is the chip that stands for no filter; it excludes the others. */
export type SeverityFilter = 'all' | AttentionSeverity;

// Root keys (marked, so the key check finds them): they are translated where the page shows them.
export const SEVERITY_FILTER_KEYS: Record<SeverityFilter, string> = {
  all: marker('app.attention.filter.all'),
  critical: marker('app.attention.filter.critical'),
  warning: marker('app.attention.filter.warning'),
  info: marker('app.attention.filter.info'),
};

export const SECTION_KEYS: Record<AttentionSeverity, string> = {
  critical: marker('app.attention.section.critical'),
  warning: marker('app.attention.section.warning'),
  info: marker('app.attention.section.info'),
};

/** The name of a kind as a card title and chip label (not a sentence about one device). */
const GROUP_KEYS: Record<AttentionKind, string> = {
  gateway_offline: marker('app.attention.group.gateway_offline'),
  device_silent: marker('app.attention.group.device_silent'),
  soil_dry: marker('app.attention.group.soil_dry'),
  soil_wet: marker('app.attention.group.soil_wet'),
  battery_low: marker('app.attention.group.battery_low'),
  contact_open: marker('app.attention.group.contact_open'),
  hardware_new: marker('app.attention.group.hardware_new'),
  cert_expiring: marker('app.attention.group.cert_expiring'),
};
const UNKNOWN_GROUP_KEY = marker('app.attention.group.unknown');

export function groupTitleKey(kind: AttentionKind): string {
  return GROUP_KEYS[kind] ?? UNKNOWN_GROUP_KEY;
}

/** The kinds a link may preselect: `?art=soil_dry` or several, separated by commas. */
export function kindsFromParam(param: string | null): AttentionKind[] {
  if (!param) return [];
  const known = new Set<string>(ATTENTION_KINDS);
  return [...new Set(param.split(','))].filter((kind): kind is AttentionKind => known.has(kind));
}

/** How many notices each severity and kind has, over all notices (the chips' numbers). */
export interface FilterCounts {
  readonly all: number;
  readonly severities: Readonly<Record<AttentionSeverity, number>>;
  /** Kinds in the order of the notices (most urgent, newest first). */
  readonly kinds: readonly { readonly kind: AttentionKind; readonly count: number }[];
}

export function filterCounts(items: readonly AttentionItem[]): FilterCounts {
  return {
    all: items.length,
    severities: {
      critical: items.filter((item) => item.severity === 'critical').length,
      warning: items.filter((item) => item.severity === 'warning').length,
      info: items.filter((item) => item.severity === 'info').length,
    },
    kinds: groupAttention(items).map((group) => ({
      kind: group.kind,
      count: group.items.length,
    })),
  };
}

/**
 * What to show for the chosen chips. No severity chip (or "all") and no kind chip show everything;
 * kinds that no notice has (a link that is older than the notices) are ignored rather than showing
 * an empty page.
 */
export function filterAttention(
  items: readonly AttentionItem[],
  severities: readonly SeverityFilter[],
  kinds: readonly AttentionKind[],
): AttentionItem[] {
  const present = new Set(items.map((item) => item.kind));
  const wantedKinds = new Set(kinds.filter((kind) => present.has(kind)));
  const wantedSeverities = new Set(severities.filter((s) => s !== 'all'));
  return items.filter(
    (item) =>
      (wantedSeverities.size === 0 || wantedSeverities.has(item.severity)) &&
      (wantedKinds.size === 0 || wantedKinds.has(item.kind)),
  );
}

/** One notice on the page: its row, with the facts the template needs to say when and where. */
export interface NoticeView {
  readonly id: string;
  readonly icon: EntryView['icon'];
  readonly tone: EntryView['tone'];
  /** The title: the notice's name; a certificate says its whole sentence (the name alone is not clear). */
  readonly title: { readonly text: string } | { readonly key: string; readonly params: object };
  /** ISO 8601 UTC: since when the condition holds. */
  readonly since: string;
  /** Devices a gateway outage hides, for the second line. */
  readonly affectedDevices: number | null;
  /** "18 %", also for critical notices (the hero omits it, the list has room). */
  readonly value: string | null;
  readonly target: EntryTarget;
}

/** A card of one kind in a severity's section. */
export interface KindCard {
  readonly kind: AttentionKind;
  readonly titleKey: string;
  readonly notices: readonly NoticeView[];
}

export interface SeveritySection {
  readonly severity: AttentionSeverity;
  readonly titleKey: string;
  readonly cards: readonly KindCard[];
}

function noticeOf(item: AttentionItem, locale: string): NoticeView {
  const [group] = groupAttention([item]);
  const entry = entryOf(group!, locale);
  const affected = item.params['affectedDevices'];
  return {
    id: item.id,
    icon: entry.icon,
    tone: entry.tone,
    title:
      item.kind === 'cert_expiring'
        ? { key: entry.titleKey, params: entry.titleParams }
        : { text: item.name },
    since: item.since,
    affectedDevices:
      item.kind === 'gateway_offline' && typeof affected === 'number' && affected > 0
        ? affected
        : null,
    value: valueText(item, locale),
    target: entry.target,
  };
}

/**
 * The page's content (spec 3.4): a section per severity, most urgent first, in it a card per kind
 * with its notices in the order the server sent them (newest first).
 */
export function sectionsOf(items: readonly AttentionItem[], locale: string): SeveritySection[] {
  return ATTENTION_SEVERITIES.flatMap((severity) => {
    const cards = groupAttention(items.filter((item) => item.severity === severity)).map(
      (group) => ({
        kind: group.kind,
        titleKey: groupTitleKey(group.kind),
        notices: group.items.map((item) => noticeOf(item, locale)),
      }),
    );
    return cards.length === 0 ? [] : [{ severity, titleKey: SECTION_KEYS[severity], cards }];
  });
}
