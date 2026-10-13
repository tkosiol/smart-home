import { TestBed } from '@angular/core/testing';
import {
  DEFAULT_INSTANCE_APPEARANCE,
  DEFAULT_PERSONAL_APPEARANCE,
  type InstanceAppearance,
} from '@smart/contracts';
import { computeThemeVars } from '@smart/theme';
import { APPEARANCE_STORE } from './appearance-store';
import { MemoryAppearanceStore } from './memory-appearance-store';
import { MEDIA_QUERIES, type MediaQueries } from './media-queries';
import { provideTheme } from './provide-theme';
import { THEME_ENGINE_LOADER, loadThemeEngine, type ThemeEngine } from './theme-engine';
import { ThemeService } from './theme.service';

class FakeMedia implements MediaQueries {
  state: Record<string, boolean> = {};
  private listeners: Record<string, ((matches: boolean) => void)[]> = {};
  matches = (query: string) => this.state[query] ?? false;
  listen = (query: string, callback: (matches: boolean) => void) => {
    (this.listeners[query] ??= []).push(callback);
    return () => undefined;
  };
  emit(query: string, value: boolean) {
    this.state[query] = value;
    this.listeners[query]?.forEach((callback) => callback(value));
  }
}

async function setup(
  store = new MemoryAppearanceStore(),
  media = new FakeMedia(),
  options: { instance?: InstanceAppearance; allowStoredInstance?: boolean } = {},
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
          { provide: MEDIA_QUERIES, useValue: new FakeMedia() },
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

  it('ignores a browser-stored instance theme while the instance editor is off', async () => {
    const store = new MemoryAppearanceStore();
    store.instance = sharpInstance;
    const { service } = await setup(store, new FakeMedia(), { instance: plumInstance });
    expect(service.instance()).toEqual(plumInstance);
  });

  it('prefers a browser-stored instance theme while the instance editor is on', async () => {
    const store = new MemoryAppearanceStore();
    store.instance = sharpInstance;
    const { service } = await setup(store, new FakeMedia(), {
      instance: plumInstance,
      allowStoredInstance: true,
    });
    expect(service.instance()).toEqual(sharpInstance);
  });

  it('adopts an instance stored in another tab only while the instance editor is on', async () => {
    const off = await setup(new MemoryAppearanceStore(), new FakeMedia(), {
      instance: plumInstance,
    });
    off.store.instance = sharpInstance;
    off.store.emit('instance');
    TestBed.tick();
    expect(off.service.instance()).toEqual(plumInstance);
    TestBed.resetTestingModule();
    const on = await setup(new MemoryAppearanceStore(), new FakeMedia(), {
      instance: plumInstance,
      allowStoredInstance: true,
    });
    on.store.instance = sharpInstance;
    on.store.emit('instance');
    TestBed.tick();
    expect(on.service.instance()).toEqual(sharpInstance);
  });

  it('stores instance changes only while the instance editor is on', async () => {
    const off = await setup(new MemoryAppearanceStore(), new FakeMedia());
    off.service.setInstance(sharpInstance);
    expect(off.service.instance()).toEqual(sharpInstance);
    expect(off.store.instance).toBeNull();
    TestBed.resetTestingModule();
    const on = await setup(new MemoryAppearanceStore(), new FakeMedia(), {
      allowStoredInstance: true,
    });
    on.service.setInstance(sharpInstance);
    expect(on.store.instance).toEqual(sharpInstance);
  });

  it('resets the instance to the installation default and forgets the stored one', async () => {
    const { service, store } = await setup(new MemoryAppearanceStore(), new FakeMedia(), {
      instance: plumInstance,
      allowStoredInstance: true,
    });
    service.setInstance(sharpInstance);
    service.resetInstance();
    expect(service.instance()).toEqual(plumInstance);
    expect(store.instance).toBeNull();
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
    const media = new FakeMedia();
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
