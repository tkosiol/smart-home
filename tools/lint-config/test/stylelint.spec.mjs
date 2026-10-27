import path from 'node:path';
import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';
import config from '../stylelint/index.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const COMPONENT = 'apps/frontend/projects/ui/src/lib/button/button.scss';

async function rulesFor(code, relativePath = COMPONENT) {
  const { results } = await stylelint.lint({
    code,
    codeFilename: path.join(repoRoot, relativePath),
    config,
    cwd: repoRoot,
  });
  return results[0]?.warnings.map((w) => w.rule) ?? [];
}

describe('stylelint: only design tokens in component styles', () => {
  it('accepts token-based declarations', async () => {
    const css =
      '.a {\n  color: var(--mat-sys-primary);\n  padding: var(--smart-space-md);\n  gap: 0;\n}\n';
    expect(await rulesFor(css)).toEqual([]);
  });

  it.each([
    ['hex colors', '.a {\n  color: #fff;\n}\n', 'color-no-hex'],
    ['named colors', '.a {\n  color: red;\n}\n', 'color-named'],
    ['color functions', '.a {\n  color: rgb(0 0 0);\n}\n', 'function-disallowed-list'],
    ['raw spacing', '.a {\n  padding: 16px;\n}\n', 'scale-unlimited/declaration-strict-value'],
    ['raw gap', '.a {\n  gap: 8px;\n}\n', 'scale-unlimited/declaration-strict-value'],
    ['raw radius', '.a {\n  border-radius: 4px;\n}\n', 'scale-unlimited/declaration-strict-value'],
  ])('rejects %s', async (_name, css, rule) => {
    expect(await rulesFor(css)).toContain(rule);
  });

  it.each([
    ['px inside calc()', '.a {\n  padding: calc(13px);\n}\n', 'unit-disallowed-list'],
    ['px inside max()', '.a {\n  font-size: max(12px, 1rem);\n}\n', 'unit-disallowed-list'],
    ['font shorthand', '.a {\n  font: 16px/1.5 serif;\n}\n', 'unit-disallowed-list'],
    ['raw durations', '.a {\n  transition: all 200ms;\n}\n', 'unit-disallowed-list'],
    ['raw sizes', '.a {\n  width: 13px;\n}\n', 'unit-disallowed-list'],
    ['SCSS variables', '$x: 13%;\n', 'scss/no-dollar-variables'],
    ['local custom properties', '.a {\n  --local: 1;\n}\n', 'property-disallowed-list'],
    ['Material internals', '.mat-mdc-button {\n  opacity: 1;\n}\n', 'selector-disallowed-list'],
    ['MDC internals', '.mdc-button {\n  opacity: 1;\n}\n', 'selector-disallowed-list'],
    ['::ng-deep', ':host ::ng-deep .x {\n  opacity: 1;\n}\n', 'selector-disallowed-list'],
  ])('rejects %s outside the token files', async (_name, css, rule) => {
    expect(await rulesFor(css)).toContain(rule);
  });

  it('accepts --ui-* custom properties, the styling API of ui-* components', async () => {
    const css = ':host {\n  --ui-button-text-color: currentcolor;\n}\n';
    expect(await rulesFor(css)).toEqual([]);
  });

  it.each([
    ['raw values in --ui-* properties', ':host {\n  --ui-x: 13px;\n}\n', 'unit-disallowed-list'],
    ['hex colors in --ui-* properties', ':host {\n  --ui-x: #fff;\n}\n', 'color-no-hex'],
    [
      'tokens redefined in a component',
      ':host {\n  --smart-x: 0;\n}\n',
      'property-disallowed-list',
    ],
  ])('rejects %s', async (_name, css, rule) => {
    expect(await rulesFor(css)).toContain(rule);
  });

  it('accepts a BEM-style modifier class but not other casing', async () => {
    expect(await rulesFor(':host(.ui-icon--filled) {\n  opacity: 1;\n}\n')).toEqual([]);
    expect(await rulesFor('.uiIcon {\n  opacity: 1;\n}\n')).toContain('selector-class-pattern');
    expect(await rulesFor('.ui-icon__x--y--z {\n  opacity: 1;\n}\n')).toContain(
      'selector-class-pattern',
    );
  });

  it('accepts relative layout values', async () => {
    const css =
      '.a {\n  width: 100%;\n  grid-template-columns: 1fr 2fr;\n  padding: calc(var(--smart-space-md) * 2);\n}\n';
    expect(await rulesFor(css)).toEqual([]);
  });

  it('lints plain .css files in the UI library too', async () => {
    expect(
      await rulesFor('.a {\n  color: #fff;\n}\n', 'apps/frontend/projects/ui/src/lib/x/x.css'),
    ).toContain('color-no-hex');
  });

  it('allows raw values inside the token files', async () => {
    const scss = '$seed: #6750a4;\n:root {\n  --smart-space-md: 16px;\n}\n';
    expect(await rulesFor(scss, 'apps/frontend/projects/ui/src/lib/tokens/_palette.scss')).toEqual(
      [],
    );
  });
});
