import { TestBed } from '@angular/core/testing';
import {
  TopBarActions,
  injectMoreEntries,
  provideFeature,
  visibleMoreEntries,
  type FeatureDefinition,
  type MoreEntry,
  type TopBarAction,
} from './feature-registry';

function setup(...features: FeatureDefinition[]) {
  TestBed.configureTestingModule({ providers: features.map((f) => provideFeature(f)) });
  return TestBed.runInInjectionContext(() => ({ entries: injectMoreEntries() }));
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

  it('is empty without features and ignores features without entries', () => {
    expect(setup()).toEqual({ entries: [] });
    TestBed.resetTestingModule();
    expect(setup({})).toEqual({ entries: [] });
  });
});

describe('top bar action', () => {
  const action = (id: string): TopBarAction => ({
    id,
    icon: 'settings',
    labelKey: `app.${id}`,
    run: () => undefined,
  });

  it('shows an action and takes it away again', () => {
    const bar = TestBed.inject(TopBarActions);
    expect(bar.action()).toBeNull();
    const remove = bar.show(action('customise'));
    expect(bar.action()?.id).toBe('customise');
    remove();
    expect(bar.action()).toBeNull();
  });

  it('lets the next page replace the action, and the old remover leaves the new one alone', () => {
    const bar = TestBed.inject(TopBarActions);
    const removeFirst = bar.show(action('first'));
    const second = action('second');
    bar.show(second);
    removeFirst();
    expect(bar.action()).toBe(second);
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
