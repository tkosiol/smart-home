import { TestBed } from '@angular/core/testing';
import {
  DEFAULT_INSTANCE_APPEARANCE,
  DEFAULT_PERSONAL_APPEARANCE,
  type InstanceAppearance,
} from '@smart/contracts';
import { computeThemeVars } from '@smart/theme';
import { APPEARANCE_STORE } from './appearance-store';
import { MemoryAppearanceStore } from './memory-appearance-store';
import { MEDIA_QUERIES } from './media-queries';
import { provideTheme } from './provide-theme';
import { FakeMediaQueries } from './testing/fake-media-queries';
import { THEME_ENGINE_LOADER, loadThemeEngine, type ThemeEngine } from './theme-engine';
import { ThemeService } from './theme.service';

async function setup(
  store = new MemoryAppearanceStore(),
  media = new FakeMediaQueries(),
  options: { instance?: InstanceAppearance } = {},
) {
  TestBed.configureTestingModule({
    providers: [
      provideTheme(options),
      { provide: APPEARANCE_STORE, useValue: store },
      { provide: MEDIA_QUERIES, useValue: media },
    ],
  });
  const service = TestBed.inject(ThemeService);
  await service.ready;
  TestBed.tick();
  return { service, store, media };
}
const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name);
const base = {
  colors: DEFAULT_INSTANCE_APPEARANCE.colors,
  shape: 'standard' as const,
  font: 'roboto-flex' as const,
};
const plum = { seed: '#6e4c7e', variant: 'vibrant' as const, colorMatch: false, coreOverrides: {} };

describe('ThemeService', () => {
  afterEach(() => document.documentElement.removeAttribute('style'));

  describe('color engine', () => {
    function setupWithLoader(loader: () => Promise<ThemeEngine>) {
      const store = new MemoryAppearanceStore();
      TestBed.configureTestingModule({
        providers: [
          provideTheme(),
          { provide: APPEARANCE_STORE, useValue: store },
          { provide: MEDIA_QUERIES, useValue: new FakeMediaQueries() },
          { provide: THEME_ENGINE_LOADER, useValue: loader },
        ],
      });
      const service = TestBed.inject(ThemeService);
      TestBed.tick();
      return { service, store };
    }

    it('sets no variables until the engine is loaded, then applies the theme', async () => {
      let release!: (engine: ThemeEngine) => void;
      const { service, store } = setupWithLoader(
        () => new Promise<ThemeEngine>((resolve) => (release = resolve)),
      );
      expect(rootVar('--mat-sys-primary')).toBe('');
      expect(store.boot).toBeNull();
      expect(service.resolved().mode).toBe('light');
      release(await loadThemeEngine());
      await service.ready;
      TestBed.tick();
      expect(rootVar('--mat-sys-primary')).not.toBe('');
      expect(store.boot).not.toBeNull();
    });

    it('warns and keeps the default theme when the engine cannot be loaded', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { service, store } = setupWithLoader(() => Promise.reject(new Error('offline')));
      await service.ready;
      TestBed.tick();
      expect(warn).toHaveBeenCalledOnce();
      expect(rootVar('--mat-sys-primary')).toBe('');
      expect(store.boot).toBeNull();
      expect(service.resolved().mode).toBe('light');
      warn.mockRestore();
    });
  });

  it('applies the default theme to the document root', async () => {
    await setup();
    expect(rootVar('--mat-sys-primary')).toBe(
      computeThemeVars({ ...base, mode: 'light', contrast: 'standard' })['--mat-sys-primary'],
    );
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('follows the system switching to dark while mode is system', async () => {
    const { media } = await setup();
    media.emit('(prefers-color-scheme: dark)', true);
    TestBed.tick();
    expect(rootVar('--mat-sys-surface')).toBe(
      computeThemeVars({ ...base, mode: 'dark', contrast: 'standard' })['--mat-sys-surface'],
    );
  });

  it('uses high contrast when the system asks for more contrast', async () => {
    const { media } = await setup();
    media.emit('(prefers-contrast: more)', true);
    TestBed.tick();
    expect(rootVar('--mat-sys-on-surface-variant')).toBe(
      computeThemeVars({ ...base, mode: 'light', contrast: 'high' })[
        '--mat-sys-on-surface-variant'
      ],
    );
  });

  it('keeps an explicit mode when the system changes', async () => {
    const { service, media } = await setup();
    service.setPersonal({ mode: 'light', contrast: 'system' });
    media.emit('(prefers-color-scheme: dark)', true);
    TestBed.tick();
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('persists personal changes and the boot cache for both modes', async () => {
    const { service, store } = await setup();
    service.setPersonal({ mode: 'dark', contrast: 'system', colors: plum });
    TestBed.tick();
    expect(store.personal?.mode).toBe('dark');
    expect(store.boot?.mode).toBe('dark');
    expect(store.boot?.light['--mat-sys-primary']).not.toBe(store.boot?.dark['--mat-sys-primary']);
  });

  describe('personal changes by the user and by the server', () => {
    it('tells listeners about changes the user makes, not about adopted ones', async () => {
      const { service } = await setup();
      const seen: unknown[] = [];
      service.onPersonalChange((value) => seen.push(value));
      service.setPersonal({ mode: 'dark', contrast: 'system' });
      service.resetPersonal();
      service.setPersonal({ mode: 'dark', contrast: 'system', colors: plum });
      service.resetPersonalColors();
      service.adoptPersonal({ mode: 'light', contrast: 'high' });
      expect(seen).toEqual([
        { mode: 'dark', contrast: 'system' },
        DEFAULT_PERSONAL_APPEARANCE,
        { mode: 'dark', contrast: 'system', colors: plum },
        { mode: 'dark', contrast: 'system' },
      ]);
    });

    it('adopts a value from the server: applies and stores it without telling listeners', async () => {
      const { service, store } = await setup();
      const listener = vi.fn();
      service.onPersonalChange(listener);
      service.adoptPersonal({ mode: 'dark', contrast: 'high', colors: plum });
      TestBed.tick();
      expect(service.personal()).toEqual({ mode: 'dark', contrast: 'high', colors: plum });
      expect(store.personal).toEqual({ mode: 'dark', contrast: 'high', colors: plum });
      expect(store.boot?.mode).toBe('dark');
      expect(listener).not.toHaveBeenCalled();
    });

    it('stops telling a listener that unsubscribed', async () => {
      const { service } = await setup();
      const listener = vi.fn();
      const stop = service.onPersonalChange(listener);
      stop();
      service.setPersonal({ mode: 'dark', contrast: 'system' });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  it('resets personal colors to the instance default', async () => {
    const { service } = await setup();
    service.setPersonal({ mode: 'system', contrast: 'system', colors: plum });
    service.resetPersonalColors();
    TestBed.tick();
    expect(service.resolved().colors).toEqual(DEFAULT_INSTANCE_APPEARANCE.colors);
  });

  it('starts from stored settings', async () => {
    const store = new MemoryAppearanceStore();
    store.personal = { mode: 'dark', contrast: 'medium' };
    const { service } = await setup(store);
    expect([service.resolved().mode, service.resolved().contrast]).toEqual(['dark', 'medium']);
  });

  const plumInstance: InstanceAppearance = { ...DEFAULT_INSTANCE_APPEARANCE, colors: plum };
  const sharpInstance: InstanceAppearance = { ...DEFAULT_INSTANCE_APPEARANCE, shape: 'kantig' };

  it('prefers the copy of the server value on the device to config.json', async () => {
    const store = new MemoryAppearanceStore();
    store.instance = sharpInstance;
    const { service } = await setup(store, new FakeMediaQueries(), { instance: plumInstance });
    expect(service.instance()).toEqual(sharpInstance);
  });

  it('uses config.json without a stored copy and the build default without both', async () => {
    const withConfig = await setup(new MemoryAppearanceStore(), new FakeMediaQueries(), {
      instance: plumInstance,
    });
    expect(withConfig.service.instance()).toEqual(plumInstance);
    TestBed.resetTestingModule();
    const bare = await setup();
    expect(bare.service.instance()).toEqual(DEFAULT_INSTANCE_APPEARANCE);
  });

  it('keeps the stored copy over config.json after a restart of the service', async () => {
    const first = await setup(new MemoryAppearanceStore(), new FakeMediaQueries(), {
      instance: plumInstance,
    });
    first.service.adoptInstance(sharpInstance);
    TestBed.resetTestingModule();
    const second = await setup(first.store, new FakeMediaQueries(), { instance: plumInstance });
    expect(second.service.instance()).toEqual(sharpInstance);
  });

  it('adopts an instance stored in another tab', async () => {
    const { service, store } = await setup(new MemoryAppearanceStore(), new FakeMediaQueries(), {
      instance: plumInstance,
    });
    store.instance = sharpInstance;
    store.emit('instance');
    TestBed.tick();
    expect(service.instance()).toEqual(sharpInstance);
  });

  describe('instance appearance from the server', () => {
    it('applies and stores an adopted value without telling the listeners', async () => {
      const { service, store } = await setup();
      const listener = vi.fn();
      service.onInstanceChange(listener);
      service.adoptInstance(sharpInstance);
      expect(service.instance()).toEqual(sharpInstance);
      expect(store.instance).toEqual(sharpInstance);
      expect(listener).not.toHaveBeenCalled();
    });

    it('falls back to config.json when the server has none stored', async () => {
      const { service, store } = await setup(new MemoryAppearanceStore(), new FakeMediaQueries(), {
        instance: plumInstance,
      });
      service.adoptInstance(sharpInstance);
      const listener = vi.fn();
      service.onInstanceChange(listener);
      service.adoptInstance(null);
      expect(service.instance()).toEqual(plumInstance);
      expect(store.instance).toBeNull();
      expect(listener).not.toHaveBeenCalled();
    });

    it('falls back to the build default when neither server nor config.json have a value', async () => {
      const { service } = await setup();
      service.adoptInstance(sharpInstance);
      service.adoptInstance(null);
      expect(service.instance()).toEqual(DEFAULT_INSTANCE_APPEARANCE);
    });

    it('rejects an invalid server value and keeps the current one', async () => {
      const { service, store } = await setup();
      expect(() =>
        service.adoptInstance({ ...sharpInstance, shape: 'rund' } as unknown as InstanceAppearance),
      ).toThrow();
      expect(service.instance()).toEqual(DEFAULT_INSTANCE_APPEARANCE);
      expect(store.instance).toBeNull();
    });
  });

  describe('editing the instance appearance', () => {
    it('stores the change as a copy and tells the listeners exactly once', async () => {
      const { service, store } = await setup();
      const listener = vi.fn();
      service.onInstanceChange(listener);
      service.setInstance(sharpInstance);
      expect(service.instance()).toEqual(sharpInstance);
      expect(store.instance).toEqual(sharpInstance);
      expect(listener).toHaveBeenCalledExactlyOnceWith(sharpInstance);
    });

    it('reports a reset as null and shows config.json again', async () => {
      const { service, store } = await setup(new MemoryAppearanceStore(), new FakeMediaQueries(), {
        instance: plumInstance,
      });
      service.setInstance(sharpInstance);
      const listener = vi.fn();
      service.onInstanceChange(listener);
      service.resetInstance();
      expect(service.instance()).toEqual(plumInstance);
      expect(store.instance).toBeNull();
      expect(listener).toHaveBeenCalledExactlyOnceWith(null);
    });

    it('stops telling a listener that unsubscribed', async () => {
      const { service } = await setup();
      const listener = vi.fn();
      const stop = service.onInstanceChange(listener);
      stop();
      service.setInstance(sharpInstance);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  it('resets everything personal to the defaults', async () => {
    const { service, store } = await setup();
    service.setPersonal({ mode: 'dark', contrast: 'high', colors: plum });
    service.resetPersonal();
    expect(service.personal()).toEqual(DEFAULT_PERSONAL_APPEARANCE);
    expect(store.personal).toBeNull();
  });

  it('exposes instance and personal read-only', async () => {
    const { service } = await setup();
    expect('set' in service.instance).toBe(false);
    expect('set' in service.personal).toBe(false);
  });

  it('follows changes another tab stored', async () => {
    const { service, store } = await setup();
    store.personal = { mode: 'dark', contrast: 'standard' };
    store.emit('personal');
    TestBed.tick();
    expect(service.personal()).toEqual({ mode: 'dark', contrast: 'standard' });
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('caches both contrast levels while the contrast follows the system', async () => {
    const { store } = await setup();
    const expected = (mode: 'light' | 'dark', contrast: 'standard' | 'high') =>
      computeThemeVars({ ...base, mode, contrast })['--mat-sys-primary'];
    expect(store.boot).toMatchObject({ v: 2, mode: 'system', followsSystemContrast: true });
    expect(store.boot?.light['--mat-sys-primary']).toBe(expected('light', 'standard'));
    expect(store.boot?.darkHigh?.['--mat-sys-primary']).toBe(expected('dark', 'high'));
  });

  it('keeps standard contrast in the cache while the system currently asks for more', async () => {
    const media = new FakeMediaQueries();
    media.state['(prefers-contrast: more)'] = true;
    const { store } = await setup(new MemoryAppearanceStore(), media);
    expect(rootVar('--mat-sys-on-surface-variant')).toBe(
      computeThemeVars({ ...base, mode: 'light', contrast: 'high' })[
        '--mat-sys-on-surface-variant'
      ],
    );
    expect(store.boot?.light['--mat-sys-on-surface-variant']).toBe(
      computeThemeVars({ ...base, mode: 'light', contrast: 'standard' })[
        '--mat-sys-on-surface-variant'
      ],
    );
  });

  it('caches only the chosen contrast when the user picked one', async () => {
    const { service, store } = await setup();
    service.setPersonal({ mode: 'dark', contrast: 'medium' });
    TestBed.tick();
    expect(store.boot).toMatchObject({ v: 2, mode: 'dark', followsSystemContrast: false });
    expect(store.boot?.lightHigh).toBeUndefined();
    expect(store.boot?.dark['--mat-sys-primary']).toBe(
      computeThemeVars({ ...base, mode: 'dark', contrast: 'medium' })['--mat-sys-primary'],
    );
  });
});
