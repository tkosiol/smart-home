import {
  InjectionToken,
  inject,
  reflectComponentType,
  type Provider,
  type Type,
} from '@angular/core';
import { hasRole, type HouseholdRole } from '@smart/contracts';
import type { IconName } from '@smart/ui/shell';

/** An entry on the "More" page. */
export interface MoreEntry {
  readonly id: string;
  /** Root translation key, marked with `marker()` where it is defined. */
  readonly labelKey: string;
  readonly icon: IconName;
  /** Without a route the entry is shown as "coming soon" and is not clickable. */
  readonly route?: string;
  readonly order: number;
  /** Hidden for users whose role in the current household is lower (the route guards it too). */
  readonly minRole?: HouseholdRole;
  /** Hidden for everyone but the platform admin. */
  readonly platformAdminOnly?: boolean;
}

/**
 * A card on the overview: a component, or a function that loads it (`() => import(...)`), so a
 * feature's card code stays out of the initial bundle.
 */
export type OverviewCard = Type<unknown> | (() => Promise<Type<unknown>>);

/** What a feature contributes to the shared pages, so the shell never imports a feature. */
export interface FeatureDefinition {
  readonly moreEntries?: readonly MoreEntry[];
  readonly overviewCards?: readonly OverviewCard[];
}

export const FEATURES = new InjectionToken<readonly FeatureDefinition[]>('FEATURES');

export function provideFeature(definition: FeatureDefinition): Provider {
  return { provide: FEATURES, useValue: definition, multi: true };
}

/** All registered entries, sorted by order; empty when no feature registered any. */
export function injectMoreEntries(): MoreEntry[] {
  const features = inject(FEATURES, { optional: true }) ?? [];
  return features.flatMap((f) => f.moreEntries ?? []).sort((a, b) => a.order - b.order);
}

/** The entries this user may use; without a household (`role` null) a role requirement is not met. */
export function visibleMoreEntries(
  entries: readonly MoreEntry[],
  access: { readonly role: HouseholdRole | null; readonly platformAdmin: boolean },
): MoreEntry[] {
  return entries.filter(
    (entry) =>
      (entry.minRole === undefined ||
        (access.role !== null && hasRole(access.role, entry.minRole))) &&
      (!entry.platformAdminOnly || access.platformAdmin),
  );
}

export function injectOverviewCards(): OverviewCard[] {
  const features = inject(FEATURES, { optional: true }) ?? [];
  return features.flatMap((f) => f.overviewCards ?? []);
}

/** Whether `card` is a loader function: anything that is not a component class. */
export function isCardLoader(card: OverviewCard): card is () => Promise<Type<unknown>> {
  return reflectComponentType(card as Type<unknown>) === null;
}

/**
 * The card components in registration order. Loaders run once; a loader that fails (a lost chunk,
 * say) drops only its own card.
 */
export async function resolveOverviewCards(
  cards: readonly OverviewCard[],
): Promise<Type<unknown>[]> {
  const settled = await Promise.allSettled(
    cards.map((card) => (isCardLoader(card) ? card() : Promise.resolve(card))),
  );
  return settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}
