import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  injectMoreEntries,
  injectOverviewCards,
  provideFeature,
  visibleMoreEntries,
  type MoreEntry,
  type FeatureDefinition,
} from './feature-registry';

@Component({ selector: 'app-card-a', template: '' })
class CardA {}
@Component({ selector: 'app-card-b', template: '' })
class CardB {}

function setup(...features: FeatureDefinition[]) {
  TestBed.configureTestingModule({ providers: features.map((f) => provideFeature(f)) });
  return TestBed.runInInjectionContext(() => ({
    entries: injectMoreEntries(),
    cards: injectOverviewCards(),
  }));
}

describe('feature registry', () => {
  it('sorts the more entries of all features by order', () => {
    const { entries } = setup(
      {
        moreEntries: [
          {
            id: 'settings',
            labelKey: 'a',
            icon: 'settings',
            route: '/mehr/einstellungen',
            order: 30,
          },
          { id: 'modules', labelKey: 'b', icon: 'extension', order: 10 },
        ],
      },
      { moreEntries: [{ id: 'gateways', labelKey: 'c', icon: 'router', order: 20 }] },
    );
    expect(entries.map((e) => e.id)).toEqual(['modules', 'gateways', 'settings']);
  });

  it('collects the overview cards of all features', () => {
    const { cards } = setup({ overviewCards: [CardA] }, { overviewCards: [CardB] });
    expect(cards).toEqual([CardA, CardB]);
  });

  it('is empty without features and ignores features without entries', () => {
    expect(setup()).toEqual({ entries: [], cards: [] });
    TestBed.resetTestingModule();
    expect(setup({})).toEqual({ entries: [], cards: [] });
  });
});

describe('visibleMoreEntries', () => {
  const entry = (id: string, rights: Partial<MoreEntry> = {}): MoreEntry => ({
    id,
    labelKey: id,
    icon: 'settings',
    order: 1,
    ...rights,
  });
  const entries = [
    entry('open'),
    entry('members', { minRole: 'owner' }),
    entry('devices', { minRole: 'member' }),
    entry('instance', { platformAdminOnly: true }),
  ];
  const ids = (role: Parameters<typeof visibleMoreEntries>[1]['role'], platformAdmin = false) =>
    visibleMoreEntries(entries, { role, platformAdmin }).map((e) => e.id);

  it('hides entries whose minimum role the user lacks', () => {
    expect(ids('member')).toEqual(['open', 'devices']);
    expect(ids('viewer')).toEqual(['open']);
    expect(ids('owner')).toEqual(['open', 'members', 'devices']);
  });

  it('shows platform admin entries to the platform admin only', () => {
    expect(ids('owner', true)).toEqual(['open', 'members', 'devices', 'instance']);
    expect(ids('owner', false)).not.toContain('instance');
  });

  it('hides entries that need a role when there is no household', () => {
    expect(ids(null)).toEqual(['open']);
    expect(ids(null, true)).toEqual(['open', 'instance']);
  });
});
