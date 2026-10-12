import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOOT_CACHE_VERSION } from '@smart/ui';

const script = readFileSync(join(process.cwd(), 'public/theme-boot.js'), 'utf8');
const run = () => new Function(script)() as void;
const root = () => document.documentElement.style;
const stubMatchMedia = (matching: { dark?: boolean; moreContrast?: boolean }) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches:
        (query.includes('prefers-color-scheme: dark') && !!matching.dark) ||
        (query.includes('prefers-contrast: more') && !!matching.moreContrast),
    }),
  });
};

describe('theme-boot.js', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
  });
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('accepts exactly the cache version the ThemeService writes', () => {
    // The script is plain JavaScript and cannot import the constant; this ties both together.
    expect(script).toContain(`cache.v !== ${BOOT_CACHE_VERSION}`);
  });

  it('applies the cached dark theme before Angular starts', () => {
    localStorage.setItem(
      'smart.theme.boot',
      JSON.stringify({
        v: 2,
        mode: 'dark',
        followsSystemContrast: false,
        light: { '--mat-sys-surface': '#ffffff' },
        dark: { '--mat-sys-surface': '#101415' },
      }),
    );
    run();
    expect(root().getPropertyValue('--mat-sys-surface')).toBe('#101415');
    expect(root().colorScheme).toBe('dark');
  });

  it('does nothing without a cache', () => {
    run();
    expect(root().getPropertyValue('--mat-sys-surface')).toBe('');
  });

  it.each([
    'not json',
    'null',
    '{"v":2,"followsSystemContrast":false,"mode":"dark"}',
    '{"v":2,"followsSystemContrast":false,"mode":"dark","light":null,"dark":null}',
    '{"v":2,"followsSystemContrast":false,"mode":"dark","light":{},"dark":{}}',
    '{"v":2,"followsSystemContrast":false,"mode":"dark","light":{},"dark":{"color":"red"}}',
    '{"v":2,"followsSystemContrast":false,"mode":"dark","light":{},"dark":{"--mat-sys-surface":42}}',
    '{"mode":"dark","light":{},"dark":{"--mat-sys-surface":"#101415"}}',
    '{"v":1,"mode":"dark","followsSystemContrast":false,"light":{},"dark":{"--mat-sys-surface":"#101415"}}',
  ])('ignores unusable cache %j', (raw) => {
    localStorage.setItem('smart.theme.boot', raw);
    expect(run).not.toThrow();
    // Nothing may be applied, not even the color scheme: dark form controls on the light default theme are unreadable.
    expect(root().getPropertyValue('color')).toBe('');
    expect(root().getPropertyValue('--mat-sys-surface')).toBe('');
    expect(root().colorScheme).toBe('');
  });

  describe('with mode system', () => {
    const cache = JSON.stringify({
      v: 2,
      mode: 'system',
      followsSystemContrast: false,
      light: { '--mat-sys-surface': '#ffffff' },
      dark: { '--mat-sys-surface': '#101415' },
    });

    it('applies the dark variables when the system prefers dark', () => {
      stubMatchMedia({ dark: true });
      localStorage.setItem('smart.theme.boot', cache);
      run();
      expect(root().getPropertyValue('--mat-sys-surface')).toBe('#101415');
      expect(root().colorScheme).toBe('dark');
    });

    it('applies the light variables when the system prefers light', () => {
      stubMatchMedia({});
      localStorage.setItem('smart.theme.boot', cache);
      run();
      expect(root().getPropertyValue('--mat-sys-surface')).toBe('#ffffff');
      expect(root().colorScheme).toBe('light');
    });
  });

  describe('with contrast following the system', () => {
    const cache = JSON.stringify({
      v: 2,
      mode: 'light',
      followsSystemContrast: true,
      light: { '--mat-sys-outline': '#6f7979' },
      dark: { '--mat-sys-outline': '#899393' },
      lightHigh: { '--mat-sys-outline': '#293233' },
      darkHigh: { '--mat-sys-outline': '#e9f2f3' },
    });

    it('applies the high contrast variables when the system asks for more contrast', () => {
      stubMatchMedia({ moreContrast: true });
      localStorage.setItem('smart.theme.boot', cache);
      run();
      expect(root().getPropertyValue('--mat-sys-outline')).toBe('#293233');
    });

    it('applies the standard variables otherwise', () => {
      stubMatchMedia({});
      localStorage.setItem('smart.theme.boot', cache);
      run();
      expect(root().getPropertyValue('--mat-sys-outline')).toBe('#6f7979');
    });

    it('applies nothing when the high contrast variables are missing', () => {
      stubMatchMedia({ moreContrast: true });
      localStorage.setItem(
        'smart.theme.boot',
        JSON.stringify({ ...JSON.parse(cache), lightHigh: undefined }),
      );
      run();
      expect(root().getPropertyValue('--mat-sys-outline')).toBe('');
      expect(root().colorScheme).toBe('');
    });
  });
});
