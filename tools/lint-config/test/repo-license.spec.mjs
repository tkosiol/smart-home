import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

const workspacePackages = [
  'package.json',
  'apps/backend/package.json',
  'apps/frontend/package.json',
  'packages/contracts/package.json',
  'tools/lint-config/package.json',
  'tests/e2e/package.json',
];

describe('repository license', () => {
  it('ships the unmodified AGPL-3.0 text', () => {
    const text = read('LICENSE');
    expect(text).toMatch(/^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/);
    expect(text).toContain('END OF TERMS AND CONDITIONS');
  });

  it.each(workspacePackages)('%s declares AGPL-3.0-only', (file) => {
    expect(JSON.parse(read(file)).license).toBe('AGPL-3.0-only');
  });

  it('lists every workspace package in this test', () => {
    const workspace = read('pnpm-workspace.yaml');
    const globs = [...workspace.matchAll(/^\s+-\s+(\S+)\/\*$/gm)].map((m) => m[1]);
    const covered = new Set(workspacePackages.map((file) => file.split('/')[0]));
    for (const glob of globs) expect(covered).toContain(glob);
  });

  it('mentions the license in the README', () => {
    expect(read('README.md')).toContain('AGPL-3.0-only');
  });
});
