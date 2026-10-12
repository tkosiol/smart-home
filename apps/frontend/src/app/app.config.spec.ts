import { TestBed } from '@angular/core/testing';
import { DEFAULT_INSTANCE_APPEARANCE, type InstanceAppearance } from '@smart/contracts';
import { APPEARANCE_STORE, MemoryAppearanceStore, ThemeService } from '@smart/ui';
import { createAppConfig } from './app.config';
import { RUNTIME_CONFIG } from './core/config';
import { injectMoreEntries } from './core/features';

const plum: InstanceAppearance = {
  ...DEFAULT_INSTANCE_APPEARANCE,
  colors: { ...DEFAULT_INSTANCE_APPEARANCE.colors, seed: '#6e4c7e' },
};

function setup(config: Parameters<typeof createAppConfig>[0], store = new MemoryAppearanceStore()) {
  TestBed.configureTestingModule({
    providers: [
      ...createAppConfig(config).providers,
      { provide: APPEARANCE_STORE, useValue: store },
    ],
  });
  return TestBed.inject(ThemeService);
}

describe('createAppConfig', () => {
  afterEach(() => document.documentElement.removeAttribute('style'));

  it('provides the runtime config and its instance default to the theme', () => {
    const config = { features: { instanceAppearanceEditor: false }, instanceAppearance: plum };
    const theme = setup(config);
    expect(TestBed.inject(RUNTIME_CONFIG)).toBe(config);
    expect(theme.instance()).toEqual(plum);
  });

  it('lets a stored instance theme win only while the instance editor is on', () => {
    const stored = new MemoryAppearanceStore();
    stored.instance = { ...plum, shape: 'kantig' };
    const theme = setup(
      { features: { instanceAppearanceEditor: true }, instanceAppearance: plum },
      stored,
    );
    expect(theme.instance().shape).toBe('kantig');
  });

  it('registers the settings entry for the More page', () => {
    setup({ features: { instanceAppearanceEditor: false }, instanceAppearance: plum });
    const entries = TestBed.runInInjectionContext(() => injectMoreEntries());
    expect(entries).toEqual([
      expect.objectContaining({
        id: 'settings',
        labelKey: 'app.more.settings',
        route: '/mehr/einstellungen',
      }),
    ]);
  });
});
