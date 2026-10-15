import {
  ATTENTION_SEVERITIES,
  type AttentionItem,
  type AttentionKind,
  type AttentionSeverity,
} from '@smart/contracts';

/** Several notices of one kind, shown as one entry (spec 4.1, rule 2). */
export interface AttentionGroup {
  readonly kind: AttentionKind;
  readonly severity: AttentionSeverity;
  /** In the order the server sent them: most urgent first, then newest first. */
  readonly items: readonly AttentionItem[];
}

/** The hero's three tones (`calm` is the row without notices). */
export type HeroTone = 'calm' | 'attention' | 'critical';

export interface HeroModel {
  readonly tone: HeroTone;
  /** Notices after suppression: grouping changes how they look, not how many there are (rule 4). */
  readonly count: number;
  readonly criticalCount: number;
  /** At most `limit` groups (rule 5). */
  readonly groups: readonly AttentionGroup[];
  /** Groups that did not fit. */
  readonly hiddenGroups: number;
}

/** Groups notices by kind. A group sits where its first (most urgent, newest) notice sat. */
export function groupAttention(items: readonly AttentionItem[]): AttentionGroup[] {
  const groups = new Map<AttentionKind, AttentionItem[]>();
  for (const item of items) {
    const group = groups.get(item.kind);
    if (group) group.push(item);
    else groups.set(item.kind, [item]);
  }
  return [...groups].map(([kind, members]) => ({
    kind,
    severity: mostUrgent(members),
    items: members,
  }));
}

function mostUrgent(items: readonly AttentionItem[]): AttentionSeverity {
  return ATTENTION_SEVERITIES.find((s) => items.some((i) => i.severity === s)) ?? 'info';
}

/**
 * What the status hero shows (spec 4.1): the tone is `critical` only while a critical notice is
 * open, `attention` for any other notice and `calm` without any; at most `limit` groups show.
 */
export function heroModel(
  items: readonly AttentionItem[],
  { limit = 3 }: { limit?: number } = {},
): HeroModel {
  const groups = groupAttention(items);
  const criticalCount = items.filter((item) => item.severity === 'critical').length;
  return {
    tone: items.length === 0 ? 'calm' : criticalCount > 0 ? 'critical' : 'attention',
    count: items.length,
    criticalCount,
    groups: groups.slice(0, limit),
    hiddenGroups: Math.max(0, groups.length - limit),
  };
}

/** What changed between two loads, for the announcement. */
export interface AttentionChange {
  /** Critical notices that were not there before. */
  readonly newCritical: readonly AttentionItem[];
  /** Any notice appeared or went away. */
  readonly changed: boolean;
}

export function attentionChange(
  previous: readonly AttentionItem[],
  next: readonly AttentionItem[],
): AttentionChange {
  const before = new Set(previous.map((item) => item.id));
  const after = new Set(next.map((item) => item.id));
  return {
    newCritical: next.filter((item) => item.severity === 'critical' && !before.has(item.id)),
    changed: before.size !== after.size || [...after].some((id) => !before.has(id)),
  };
}
