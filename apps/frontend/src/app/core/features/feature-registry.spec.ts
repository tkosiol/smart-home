import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  injectMoreEntries,
  injectOverviewCards,
  provideFeature,
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
