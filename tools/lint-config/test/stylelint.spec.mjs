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

  it('allows raw values inside the token files', async () => {
    const scss = '$seed: #6750a4;\n:root {\n  --smart-space-md: 16px;\n}\n';
    expect(await rulesFor(scss, 'apps/frontend/projects/ui/src/lib/tokens/_palette.scss')).toEqual(
      [],
    );
  });
});
