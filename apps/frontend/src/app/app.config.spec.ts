import { TestBed } from '@angular/core/testing';
import {
  ApplicationInitStatus,
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
} from '@angular/core';
import { DEFAULT_INSTANCE_APPEARANCE, type InstanceAppearance } from '@smart/contracts';
import { APPEARANCE_STORE, MemoryAppearanceStore, ThemeService } from '@smart/ui';
import { createAppConfig } from './app.config';
import { RUNTIME_CONFIG } from './core/config';
import { ApiClient, UNAUTHORIZED_HANDLER } from './core/api';
import { AuthService } from './core/auth';
import { injectMoreEntries } from './core/features';

const plum: InstanceAppearance = {
  ...DEFAULT_INSTANCE_APPEARANCE,
  colors: { ...DEFAULT_INSTANCE_APPEARANCE.colors, seed: '#6e4c7e' },
};

@Component({ selector: 'app-shell', template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class Shell {}

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

  it('restores the scroll position of pages the router comes back to', async () => {
    setup({ features: { instanceAppearanceEditor: false }, instanceAppearance: plum });
    history.scrollRestoration = 'auto';
    await TestBed.inject(ApplicationInitStatus).donePromise;
    // The router's scroller takes over the browser's restoration once the app is bootstrapped.
    TestBed.inject(ApplicationRef).bootstrap(Shell, document.createElement('app-shell'));
    expect(history.scrollRestoration).toBe('manual');
  });

  it('makes the API client injectable', () => {
    setup({ features: { instanceAppearanceEditor: false }, instanceAppearance: plum });
    expect(TestBed.inject(ApiClient)).toBeInstanceOf(ApiClient);
  });

  it('hands a 401 of the API client to the AuthService', () => {
    setup({ features: { instanceAppearanceEditor: false }, instanceAppearance: plum });
    const handle = vi.spyOn(TestBed.inject(AuthService), 'handleUnauthorized');
    TestBed.inject(UNAUTHORIZED_HANDLER)();
    expect(handle).toHaveBeenCalledOnce();
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
