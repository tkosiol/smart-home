import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const script = readFileSync(join(process.cwd(), 'public/theme-boot.js'), 'utf8');
const run = () => new Function(script)() as void;
const root = () => document.documentElement.style;

describe('theme-boot.js', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
  });

  it('applies the cached dark theme before Angular starts', () => {
    localStorage.setItem(
      'smart.theme.boot',
      JSON.stringify({
        mode: 'dark',
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

  it.each(['not json', '{"mode":"dark"}', '{"mode":"dark","light":{},"dark":{"color":"red"}}'])(
    'ignores unusable cache %j',
    (raw) => {
      localStorage.setItem('smart.theme.boot', raw);
      expect(run).not.toThrow();
      expect(root().getPropertyValue('color')).toBe('');
    },
  );

  describe('with mode system', () => {
    const cache = JSON.stringify({
      mode: 'system',
      light: { '--mat-sys-surface': '#ffffff' },
      dark: { '--mat-sys-surface': '#101415' },
    });
    const stubMatchMedia = (prefersDark: boolean) => {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: (query: string) => ({ matches: prefersDark && query.includes('dark') }),
      });
    };
    afterEach(() => {
      Reflect.deleteProperty(window, 'matchMedia');
    });

    it('applies the dark variables when the system prefers dark', () => {
      stubMatchMedia(true);
      localStorage.setItem('smart.theme.boot', cache);
      run();
      expect(root().getPropertyValue('--mat-sys-surface')).toBe('#101415');
      expect(root().colorScheme).toBe('dark');
    });

    it('applies the light variables when the system prefers light', () => {
      stubMatchMedia(false);
      localStorage.setItem('smart.theme.boot', cache);
      run();
      expect(root().getPropertyValue('--mat-sys-surface')).toBe('#ffffff');
      expect(root().colorScheme).toBe('light');
    });
  });
});
