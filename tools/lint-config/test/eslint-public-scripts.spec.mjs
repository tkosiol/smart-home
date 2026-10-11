import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { defineConfig } from 'eslint/config';
import { describe, expect, it } from 'vitest';
import { smartConfig } from '../eslint/index.mjs';

const fixtureRoot = fileURLToPath(new URL('./fixture/', import.meta.url));
const linter = new ESLint({
  cwd: fixtureRoot,
  overrideConfigFile: true,
  overrideConfig: defineConfig(smartConfig({ rootDir: fixtureRoot, typeChecked: false })),
});

async function ruleIds(relativePath, code) {
  const [result] = await linter.lintText(code, { filePath: path.join(fixtureRoot, relativePath) });
  return result.messages.map((m) => m.ruleId);
}

describe('classic scripts in the frontend public folder', () => {
  const code = "document.documentElement.style.colorScheme = window.name ? 'dark' : 'light';\n";

  it('may use browser globals', async () => {
    expect(await ruleIds('apps/frontend/public/boot.js', code)).toEqual([]);
  });

  it('still reject browser globals elsewhere in plain JS', async () => {
    expect(await ruleIds('apps/backend/scripts/boot.js', code)).toEqual(['no-undef', 'no-undef']);
  });
});
