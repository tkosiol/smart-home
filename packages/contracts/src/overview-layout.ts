import * as z from 'zod/mini';

/** The blocks of the overview page; 6c adds 'rooms'. */
export const OVERVIEW_BLOCK_IDS = ['status', 'devices', 'gateway'] as const;

export const overviewLayoutSchema = z.object({
  blocks: z
    .array(z.object({ id: z.string().check(z.maxLength(40)), visible: z.boolean() }))
    .check(z.maxLength(20)),
});
export type OverviewLayout = z.infer<typeof overviewLayoutSchema>;

export interface OverviewBlockDefault {
  id: string;
  defaultVisible: boolean;
  defaultOrder: number;
}

/**
 * Drops unknown and duplicate ids (first wins), appends known blocks that are missing with their
 * default visibility, in default order.
 */
export function normalizeOverviewLayout(
  stored: OverviewLayout | null,
  known: readonly OverviewBlockDefault[],
): OverviewLayout {
  const knownIds = new Set(known.map((block) => block.id));
  const seen = new Set<string>();
  const blocks: OverviewLayout['blocks'] = [];
  for (const block of stored?.blocks ?? []) {
    if (!knownIds.has(block.id) || seen.has(block.id)) continue;
    seen.add(block.id);
    blocks.push({ id: block.id, visible: block.visible });
  }
  const missing = known
    .filter((block) => !seen.has(block.id))
    .toSorted((a, b) => a.defaultOrder - b.defaultOrder);
  for (const block of missing) blocks.push({ id: block.id, visible: block.defaultVisible });
  return { blocks };
}
