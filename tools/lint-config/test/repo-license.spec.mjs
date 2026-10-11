import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

/** Every package.json matched by the globs in pnpm-workspace.yaml, plus the root. */
function workspacePackageFiles() {
  const globs = [...read('pnpm-workspace.yaml').matchAll(/^\s+-\s+(\S+)\/\*$/gm)].map((m) => m[1]);
  const files = ['package.json'];
  for (const dir of globs) {
    for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const file = path.join(dir, entry.name, 'package.json');
      if (entry.isDirectory() && existsSync(path.join(repoRoot, file))) files.push(file);
    }
  }
  return files;
}

describe('repository license', () => {
  it('ships the unmodified AGPL-3.0 text', () => {
    const text = read('LICENSE');
    expect(text).toMatch(/^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/);
    expect(text).toContain('END OF TERMS AND CONDITIONS');
  });

  it('finds all workspace packages', () => {
    expect(workspacePackageFiles().length).toBeGreaterThanOrEqual(6);
  });

  it.each(workspacePackageFiles())('%s declares AGPL-3.0-only', (file) => {
    expect(JSON.parse(read(file)).license).toBe('AGPL-3.0-only');
  });

  it('mentions the license in the README', () => {
    expect(read('README.md')).toContain('AGPL-3.0-only');
  });
});
