import { TestBed } from '@angular/core/testing';
import { injectMoreEntries, visibleMoreEntries } from '../../core/features';
import { provideGatewaysFeature } from './gateways-feature';

describe('gateways feature', () => {
  function entries() {
    TestBed.configureTestingModule({ providers: [provideGatewaysFeature()] });
    return TestBed.runInInjectionContext(() => injectMoreEntries());
  }

  it('adds the gateways to the "More" page as a linked entry', () => {
    expect(entries()).toEqual([
      expect.objectContaining({
        id: 'gateways',
        icon: 'router',
        route: '/mehr/gateways',
        order: 40,
        minRole: 'owner',
      }),
    ]);
  });

  it('shows the entry to owners only', () => {
    const all = entries();
    const ids = (role: 'viewer' | 'member' | 'owner') =>
      visibleMoreEntries(all, { role, platformAdmin: false }).map((entry) => entry.id);
    expect(ids('owner')).toEqual(['gateways']);
    expect(ids('member')).toEqual([]);
    expect(ids('viewer')).toEqual([]);
  });
});
