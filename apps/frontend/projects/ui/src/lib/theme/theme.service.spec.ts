import { TestBed } from '@angular/core/testing';
import {
  DEFAULT_INSTANCE_APPEARANCE,
  type InstanceAppearance,
  type PersonalAppearance,
} from '@smart/contracts';
import { computeThemeVars } from '@smart/theme';
import { APPEARANCE_STORE, type AppearanceStore, type BootCache } from './appearance-store';
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

class MemoryStore implements AppearanceStore {
  personal: PersonalAppearance | null = null;
  instance: InstanceAppearance | null = null;
  boot: BootCache | null = null;
  loadPersonal = () => this.personal;
  loadInstance = () => this.instance;
  savePersonal = (value: PersonalAppearance) => {
    this.personal = value;
  };
  saveInstance = (value: InstanceAppearance) => {
    this.instance = value;
  };
  saveBootCache = (value: BootCache) => {
    this.boot = value;
  };
}

function setup(store = new MemoryStore(), media = new FakeMedia()) {
  TestBed.configureTestingModule({
    providers: [
      provideTheme(),
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
    const store = new MemoryStore();
    store.personal = { mode: 'dark', contrast: 'medium' };
    const { service } = setup(store);
    expect([service.resolved().mode, service.resolved().contrast]).toEqual(['dark', 'medium']);
  });
});
