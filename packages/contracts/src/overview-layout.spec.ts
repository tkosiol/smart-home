import { describe, expect, it } from 'vitest';
import {
  OVERVIEW_BLOCK_IDS,
  normalizeOverviewLayout,
  overviewLayoutSchema,
  type OverviewBlockDefault,
} from './overview-layout.js';

const known: OverviewBlockDefault[] = [
  { id: 'status', defaultVisible: true, defaultOrder: 0 },
  { id: 'devices', defaultVisible: true, defaultOrder: 1 },
  { id: 'gateway', defaultVisible: false, defaultOrder: 2 },
];

describe('normalizeOverviewLayout', () => {
  it('returns the defaults for null and an empty layout', () => {
    const defaults = {
      blocks: [
        { id: 'status', visible: true },
        { id: 'devices', visible: true },
        { id: 'gateway', visible: false },
      ],
    };
    expect(normalizeOverviewLayout(null, known)).toEqual(defaults);
    expect(normalizeOverviewLayout({ blocks: [] }, known)).toEqual(defaults);
  });

  it('sorts missing blocks by default order, whatever the order of known', () => {
    const shuffled = [known[2]!, known[0]!, known[1]!];
    expect(normalizeOverviewLayout(null, shuffled).blocks.map((b) => b.id)).toEqual([
      'status',
      'devices',
      'gateway',
    ]);
  });

  it('keeps the stored order and visibility', () => {
    const stored = {
      blocks: [
        { id: 'gateway', visible: true },
        { id: 'status', visible: false },
        { id: 'devices', visible: true },
      ],
    };
    expect(normalizeOverviewLayout(stored, known)).toEqual(stored);
  });

  it('drops unknown ids', () => {
    const result = normalizeOverviewLayout(
      {
        blocks: [
          { id: 'ghost', visible: true },
          { id: 'devices', visible: false },
        ],
      },
      known,
    );
    expect(result.blocks).toEqual([
      { id: 'devices', visible: false },
      { id: 'status', visible: true },
      { id: 'gateway', visible: false },
    ]);
  });

  it('keeps the first of duplicate ids', () => {
    const result = normalizeOverviewLayout(
      {
        blocks: [
          { id: 'devices', visible: false },
          { id: 'devices', visible: true },
        ],
      },
      known,
    );
    expect(result.blocks.filter((b) => b.id === 'devices')).toEqual([
      { id: 'devices', visible: false },
    ]);
    expect(result.blocks).toHaveLength(3);
  });

  it('appends a new block with its default visibility', () => {
    const withNew = [...known, { id: 'rooms', defaultVisible: true, defaultOrder: 3 }];
    const result = normalizeOverviewLayout(
      {
        blocks: [
          { id: 'devices', visible: false },
          { id: 'status', visible: true },
          { id: 'gateway', visible: true },
        ],
      },
      withNew,
    );
    expect(result.blocks.at(-1)).toEqual({ id: 'rooms', visible: true });
  });
});

describe('overviewLayoutSchema', () => {
  it('exposes the block ids', () => {
    expect(OVERVIEW_BLOCK_IDS).toEqual(['status', 'devices', 'gateway']);
  });

  it('accepts a layout and rejects too many or too long ids', () => {
    expect(
      overviewLayoutSchema.safeParse({ blocks: [{ id: 'status', visible: true }] }).success,
    ).toBe(true);
    const many = Array.from({ length: 21 }, (_, i) => ({ id: `b${i}`, visible: true }));
    expect(overviewLayoutSchema.safeParse({ blocks: many }).success).toBe(false);
    expect(
      overviewLayoutSchema.safeParse({ blocks: [{ id: 'x'.repeat(41), visible: true }] }).success,
    ).toBe(false);
  });
});
