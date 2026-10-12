import { InjectionToken, inject, type Provider, type Type } from '@angular/core';
import type { IconName } from '@smart/ui';

/** An entry on the "More" page. */
export interface MoreEntry {
  readonly id: string;
  /** Root translation key, marked with `marker()` where it is defined. */
  readonly labelKey: string;
  readonly icon: IconName;
  /** Without a route the entry is shown as "coming soon" and is not clickable. */
  readonly route?: string;
  readonly order: number;
}

/** What a feature contributes to the shared pages, so the shell never imports a feature. */
export interface FeatureDefinition {
  readonly moreEntries?: readonly MoreEntry[];
  readonly overviewCards?: readonly Type<unknown>[];
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

export function injectOverviewCards(): Type<unknown>[] {
  const features = inject(FEATURES, { optional: true }) ?? [];
  return features.flatMap((f) => f.overviewCards ?? []);
}
