import { safeTarget } from './safe-target';

describe('safeTarget', () => {
  it.each([
    '/',
    '/raeume',
    '/mehr/einstellungen?tab=1#top',
    '/geraete/42',
    '/einladung',
    '/einladung/tok-3fA9_x',
  ])('lets the app path %s through', (path) => {
    expect(safeTarget(path)).toBe(path);
  });

  it.each([
    ['nothing', null],
    ['nothing at all', undefined],
    ['an empty string', ''],
    ['a protocol-relative URL', '//evil.example'],
    ['a protocol-relative URL with a path', '//evil.example/anmelden'],
    ['an absolute URL', 'https://evil.example/'],
    ['a script URL', 'javascript:alert(1)'],
    ['a relative path without a slash', 'raeume'],
    ['a backslash trick', '/\\evil.example'],
    ['a backslash trick before the slash', '\\/evil.example'],
    ['a tab that the browser would drop', '/\t/evil.example'],
    ['a line break that the browser would drop', '/\n/evil.example'],
    ['a space', '/ /evil.example'],
    ['a NUL character', '/\u0000/evil.example'],
    ['a line separator', '/ /evil.example'],
  ])('falls back to the start page for %s', (_name, value) => {
    expect(safeTarget(value)).toBe('/');
  });

  it('never leads back to the sign-in page', () => {
    expect(safeTarget('/anmelden')).toBe('/');
    expect(safeTarget('/anmelden?ziel=%2Fraeume')).toBe('/');
    expect(safeTarget('/anmelden#x')).toBe('/');
    expect(safeTarget('/anmelden-info')).toBe('/anmelden-info');
  });
});
