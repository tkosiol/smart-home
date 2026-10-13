import { TestBed } from '@angular/core/testing';
import { injectMoreEntries, visibleMoreEntries } from '../../core/features';
import { provideHouseholdsFeature } from './households-feature';

describe('households feature', () => {
  function entries() {
    TestBed.configureTestingModule({ providers: [provideHouseholdsFeature()] });
    return TestBed.runInInjectionContext(() => injectMoreEntries());
  }

  it('adds the household settings for owners and the members for everyone', () => {
    expect(entries()).toEqual([
      expect.objectContaining({
        id: 'household',
        icon: 'home',
        route: '/mehr/haushalt',
        minRole: 'owner',
      }),
      expect.objectContaining({
        id: 'members',
        icon: 'group',
        route: '/mehr/mitglieder',
        minRole: 'viewer',
      }),
    ]);
  });

  it('shows the household entry to owners only', () => {
    const all = entries();
    const ids = (role: 'viewer' | 'member' | 'owner') =>
      visibleMoreEntries(all, { role, platformAdmin: false }).map((entry) => entry.id);
    expect(ids('owner')).toEqual(['household', 'members']);
    expect(ids('member')).toEqual(['members']);
    expect(ids('viewer')).toEqual(['members']);
  });
});
