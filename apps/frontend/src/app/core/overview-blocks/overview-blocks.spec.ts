import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideFeature, type FeatureDefinition, type OverviewBlock } from '../features';
import {
  injectOverviewBlocks,
  isBlockLoader,
  resolveOverviewBlocks,
  usableOverviewBlocks,
} from './overview-blocks';

@Component({ selector: 'app-block-a', template: '' })
class BlockA {}
@Component({ selector: 'app-block-b', template: '' })
class BlockB {}

const block = (id: string, overrides: Partial<OverviewBlock> = {}): OverviewBlock => ({
  id,
  labelKey: `app.overview.blocks.${id}.label`,
  descriptionKey: `app.overview.blocks.${id}.description`,
  icon: 'home',
  defaultVisible: true,
  defaultOrder: 10,
  component: BlockA,
  ...overrides,
});

function setup(...features: FeatureDefinition[]) {
  TestBed.configureTestingModule({ providers: features.map((f) => provideFeature(f)) });
  return TestBed.runInInjectionContext(() => injectOverviewBlocks());
}

describe('overview blocks', () => {
  it('collects the overview blocks of all features in default order', () => {
    const blocks = setup(
      { overviewBlocks: [block('devices', { defaultOrder: 20 })] },
      { overviewBlocks: [block('status', { defaultOrder: 10 })] },
    );
    expect(blocks.map((b) => b.id)).toEqual(['status', 'devices']);
  });

  it('keeps the first registration of a block ID', () => {
    const blocks = setup(
      { overviewBlocks: [block('status', { component: BlockA })] },
      { overviewBlocks: [block('status', { component: BlockB })] },
    );
    expect(blocks.map((b) => b.component)).toEqual([BlockA]);
  });

  it('tells components from loaders', async () => {
    const loader = () => Promise.resolve(BlockB);
    expect(isBlockLoader(BlockA)).toBe(false);
    expect(isBlockLoader(loader)).toBe(true);
    expect(isBlockLoader(async () => BlockB)).toBe(true);
    expect(
      await resolveOverviewBlocks([
        block('a', { component: BlockA }),
        block('b', { component: loader }),
      ]),
    ).toEqual([
      { block: expect.objectContaining({ id: 'a' }), component: BlockA },
      { block: expect.objectContaining({ id: 'b' }), component: BlockB },
    ]);
  });

  it('drops only the block whose loader fails', async () => {
    const failing = () => Promise.reject(new Error('chunk lost'));
    const resolved = await resolveOverviewBlocks([
      block('a', { component: failing }),
      block('b', { component: BlockA }),
      block('c', { component: failing }),
      block('d', { component: BlockB }),
    ]);
    expect(resolved.map((entry) => entry.block.id)).toEqual(['b', 'd']);
  });

  it('is empty without features and ignores features without blocks', () => {
    expect(setup()).toEqual([]);
    TestBed.resetTestingModule();
    expect(setup({})).toEqual([]);
  });
});

describe('usableOverviewBlocks', () => {
  const blocks = [block('status'), block('gateway', { minRole: 'owner' })];
  const ids = (role: Parameters<typeof usableOverviewBlocks>[1]) =>
    usableOverviewBlocks(blocks, role).map((b) => b.id);

  it('hides blocks whose minimum role the user lacks', () => {
    expect(ids('owner')).toEqual(['status', 'gateway']);
    expect(ids('member')).toEqual(['status']);
    expect(ids('viewer')).toEqual(['status']);
  });

  it('hides blocks that need a role when there is no household', () => {
    expect(ids(null)).toEqual(['status']);
  });
});
