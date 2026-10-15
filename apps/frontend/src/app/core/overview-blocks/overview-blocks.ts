import { inject, reflectComponentType, type Type } from '@angular/core';
import { hasRole, type HouseholdRole } from '@smart/contracts';
import { FEATURES, type OverviewBlock, type OverviewBlockComponent } from '../features';

// Kept apart from the feature registry on purpose: only the overview page uses this code, and a
// file the startup code reaches (the registry) takes everything in it into the initial bundle.

/** All registered blocks in default order; the first registration of an ID wins. */
export function injectOverviewBlocks(): OverviewBlock[] {
  const features = inject(FEATURES, { optional: true }) ?? [];
  const seen = new Set<string>();
  return features
    .flatMap((f) => f.overviewBlocks ?? [])
    .filter((block) => !seen.has(block.id) && seen.add(block.id))
    .sort((a, b) => a.defaultOrder - b.defaultOrder);
}

/** The blocks this role may use; without a household (`role` null) a role requirement is not met. */
export function usableOverviewBlocks(
  blocks: readonly OverviewBlock[],
  role: HouseholdRole | null,
): OverviewBlock[] {
  return blocks.filter(
    (block) => block.minRole === undefined || (role !== null && hasRole(role, block.minRole)),
  );
}

/** Whether `component` is a loader function: anything that is not a component class. */
export function isBlockLoader(
  component: OverviewBlockComponent,
): component is () => Promise<Type<unknown>> {
  return reflectComponentType(component as Type<unknown>) === null;
}

export interface ResolvedOverviewBlock {
  readonly block: OverviewBlock;
  readonly component: Type<unknown>;
}

/**
 * The blocks with their components, in the order given. Loaders run once; a loader that fails (a
 * lost chunk, say) drops only its own block.
 */
export async function resolveOverviewBlocks(
  blocks: readonly OverviewBlock[],
): Promise<ResolvedOverviewBlock[]> {
  const settled = await Promise.allSettled(
    blocks.map((block) =>
      isBlockLoader(block.component) ? block.component() : Promise.resolve(block.component),
    ),
  );
  return settled.flatMap((result, index) =>
    result.status === 'fulfilled' ? [{ block: blocks[index]!, component: result.value }] : [],
  );
}
