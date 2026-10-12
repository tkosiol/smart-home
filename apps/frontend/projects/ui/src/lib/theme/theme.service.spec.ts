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

function setup(
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

  it('applies the default theme to the document root', () => {
    setup();
    expect(rootVar('--mat-sys-primary')).toBe(
      computeThemeVars({ ...base, mode: 'light', contrast: 'standard' })['--mat-sys-primary'],
    );
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('follows the system switching to dark while mode is system', () => {
    const { media } = setup();
    media.emit('(prefers-color-scheme: dark)', true);
    TestBed.tick();
    expect(rootVar('--mat-sys-surface')).toBe(
      computeThemeVars({ ...base, mode: 'dark', contrast: 'standard' })['--mat-sys-surface'],
    );
  });

  it('uses high contrast when the system asks for more contrast', () => {
    const { media } = setup();
    media.emit('(prefers-contrast: more)', true);
    TestBed.tick();
    expect(rootVar('--mat-sys-on-surface-variant')).toBe(
      computeThemeVars({ ...base, mode: 'light', contrast: 'high' })[
        '--mat-sys-on-surface-variant'
      ],
    );
  });

  it('keeps an explicit mode when the system changes', () => {
    const { service, media } = setup();
    service.setPersonal({ mode: 'light', contrast: 'system' });
    media.emit('(prefers-color-scheme: dark)', true);
    TestBed.tick();
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('persists personal changes and the boot cache for both modes', () => {
    const { service, store } = setup();
    service.setPersonal({ mode: 'dark', contrast: 'system', colors: plum });
    TestBed.tick();
    expect(store.personal?.mode).toBe('dark');
    expect(store.boot?.mode).toBe('dark');
    expect(store.boot?.light['--mat-sys-primary']).not.toBe(store.boot?.dark['--mat-sys-primary']);
  });

  it('resets personal colors to the instance default', () => {
    const { service } = setup();
    service.setPersonal({ mode: 'system', contrast: 'system', colors: plum });
    service.resetPersonalColors();
    TestBed.tick();
    expect(service.resolved().colors).toEqual(DEFAULT_INSTANCE_APPEARANCE.colors);
  });

  it('starts from stored settings', () => {
    const store = new MemoryAppearanceStore();
    store.personal = { mode: 'dark', contrast: 'medium' };
    const { service } = setup(store);
    expect([service.resolved().mode, service.resolved().contrast]).toEqual(['dark', 'medium']);
  });

  const plumInstance: InstanceAppearance = { ...DEFAULT_INSTANCE_APPEARANCE, colors: plum };
  const sharpInstance: InstanceAppearance = { ...DEFAULT_INSTANCE_APPEARANCE, shape: 'kantig' };

  it('ignores a browser-stored instance theme while the instance editor is off', () => {
    const store = new MemoryAppearanceStore();
    store.instance = sharpInstance;
    const { service } = setup(store, new FakeMedia(), { instance: plumInstance });
    expect(service.instance()).toEqual(plumInstance);
  });

  it('prefers a browser-stored instance theme while the instance editor is on', () => {
    const store = new MemoryAppearanceStore();
    store.instance = sharpInstance;
    const { service } = setup(store, new FakeMedia(), {
      instance: plumInstance,
      allowStoredInstance: true,
    });
    expect(service.instance()).toEqual(sharpInstance);
  });

  it('adopts an instance stored in another tab only while the instance editor is on', () => {
    const off = setup(new MemoryAppearanceStore(), new FakeMedia(), { instance: plumInstance });
    off.store.instance = sharpInstance;
    off.store.emit('instance');
    TestBed.tick();
    expect(off.service.instance()).toEqual(plumInstance);
    TestBed.resetTestingModule();
    const on = setup(new MemoryAppearanceStore(), new FakeMedia(), {
      instance: plumInstance,
      allowStoredInstance: true,
    });
    on.store.instance = sharpInstance;
    on.store.emit('instance');
    TestBed.tick();
    expect(on.service.instance()).toEqual(sharpInstance);
  });

  it('stores instance changes only while the instance editor is on', () => {
    const off = setup(new MemoryAppearanceStore(), new FakeMedia());
    off.service.setInstance(sharpInstance);
    expect(off.service.instance()).toEqual(sharpInstance);
    expect(off.store.instance).toBeNull();
    TestBed.resetTestingModule();
    const on = setup(new MemoryAppearanceStore(), new FakeMedia(), { allowStoredInstance: true });
    on.service.setInstance(sharpInstance);
    expect(on.store.instance).toEqual(sharpInstance);
  });

  it('resets the instance to the installation default and forgets the stored one', () => {
    const { service, store } = setup(new MemoryAppearanceStore(), new FakeMedia(), {
      instance: plumInstance,
      allowStoredInstance: true,
    });
    service.setInstance(sharpInstance);
    service.resetInstance();
    expect(service.instance()).toEqual(plumInstance);
    expect(store.instance).toBeNull();
  });

  it('resets everything personal to the defaults', () => {
    const { service, store } = setup();
    service.setPersonal({ mode: 'dark', contrast: 'high', colors: plum });
    service.resetPersonal();
    expect(service.personal()).toEqual(DEFAULT_PERSONAL_APPEARANCE);
    expect(store.personal).toBeNull();
  });

  it('exposes instance and personal read-only', () => {
    const { service } = setup();
    expect('set' in service.instance).toBe(false);
    expect('set' in service.personal).toBe(false);
  });

  it('follows changes another tab stored', () => {
    const { service, store } = setup();
    store.personal = { mode: 'dark', contrast: 'standard' };
    store.emit('personal');
    TestBed.tick();
    expect(service.personal()).toEqual({ mode: 'dark', contrast: 'standard' });
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('caches both contrast levels while the contrast follows the system', () => {
    const { store } = setup();
    const expected = (mode: 'light' | 'dark', contrast: 'standard' | 'high') =>
      computeThemeVars({ ...base, mode, contrast })['--mat-sys-primary'];
    expect(store.boot).toMatchObject({ v: 2, mode: 'system', followsSystemContrast: true });
    expect(store.boot?.light['--mat-sys-primary']).toBe(expected('light', 'standard'));
    expect(store.boot?.darkHigh?.['--mat-sys-primary']).toBe(expected('dark', 'high'));
  });

  it('keeps standard contrast in the cache while the system currently asks for more', () => {
    const media = new FakeMedia();
    media.state['(prefers-contrast: more)'] = true;
    const { store } = setup(new MemoryAppearanceStore(), media);
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

  it('caches only the chosen contrast when the user picked one', () => {
    const { service, store } = setup();
    service.setPersonal({ mode: 'dark', contrast: 'medium' });
    TestBed.tick();
    expect(store.boot).toMatchObject({ v: 2, mode: 'dark', followsSystemContrast: false });
    expect(store.boot?.lightHigh).toBeUndefined();
    expect(store.boot?.dark['--mat-sys-primary']).toBe(
      computeThemeVars({ ...base, mode: 'dark', contrast: 'medium' })['--mat-sys-primary'],
    );
  });
});
