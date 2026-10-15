import {
  Injectable,
  InjectionToken,
  inject,
  signal,
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
 * The component of an overview block, or a function that loads it (`() => import(...)`), so a
 * feature's block code stays out of the initial bundle.
 */
export type OverviewBlockComponent = Type<unknown> | (() => Promise<Type<unknown>>);

/**
 * A block of the overview (spec 5). The user's layout decides which blocks are shown and in which
 * order; a block that is not in the layout yet appears with its defaults.
 */
export interface OverviewBlock {
  readonly id: string;
  /** Root translation key of the name, marked with `marker()` where it is defined. */
  readonly labelKey: string;
  /** Root translation key of the explanation in the customise sheet. */
  readonly descriptionKey: string;
  readonly icon: IconName;
  readonly defaultVisible: boolean;
  /** Where the block goes when the layout does not know it (ascending). */
  readonly defaultOrder: number;
  readonly component: OverviewBlockComponent;
  /** Neither shown nor offered to users whose role in the current household is lower. */
  readonly minRole?: HouseholdRole;
  /**
   * The block is rendered even when the user hid it, with its input `visible` set to false, and
   * decides itself what to show then. The status block uses this: a critical notice is shown
   * whatever the layout says (spec 4.1, rule 7). The component must declare the input.
   */
  readonly surfaceWhenHidden?: boolean;
  /** `full`: the block spans every column of the overview's grid (the status hero, spec 3.7). */
  readonly span?: 'full';
}

/** What a feature contributes to the shared pages, so the shell never imports a feature. */
export interface FeatureDefinition {
  readonly moreEntries?: readonly MoreEntry[];
  readonly overviewBlocks?: readonly OverviewBlock[];
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

/** What one action in the shell's top bar needs: the page that adds it decides what it does. */
export interface TopBarAction {
  readonly id: string;
  readonly icon: IconName;
  /** Root translation key of the label, marked with `marker()` where it is defined. */
  readonly labelKey: string;
  readonly run: () => void;
}

/**
 * The one extra action of the shell's top bar, which the page being shown adds (the overview's
 * "customise" icon), so the shell does not know the page. One slot, not a list: a repeater in the
 * shell's template would add its runtime (about 2 kB) to the initial bundle.
 */
@Injectable({ providedIn: 'root' })
export class TopBarActions {
  private readonly slot = signal<TopBarAction | null>(null);
  readonly action = this.slot.asReadonly();

  /** Shows the action and returns the function that takes it away again (only while it is shown). */
  show(action: TopBarAction): () => void {
    this.slot.set(action);
    return () => this.slot.update((current) => (current === action ? null : current));
  }
}
