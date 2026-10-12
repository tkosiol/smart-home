#!/usr/bin/env node
// Fails when a translation key is used but missing in a language file, or present but unused.
// Wraps transloco-keys-manager, which exits 0 without checking anything when its paths are wrong.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const LANGS = ['de', 'en'];
const CLI = join(import.meta.dirname, '../node_modules/.bin/transloco-keys-manager');
/** Messages after which the tool exits 0 although it checked nothing. */
const SILENT_FAILURES = ["Translations path provided doesn't exist", 'No translation files found'];

/** Problems that would make the check pass without checking anything. */
export function validateProject(dir) {
  const configPath = resolve(dir, 'transloco.config.cjs');
  if (!existsSync(configPath)) return [`${configPath} is missing`];
  const config = require(configPath);
  const problems = [];
  if (JSON.stringify(config.langs) !== JSON.stringify(LANGS)) {
    problems.push(`langs must be ${JSON.stringify(LANGS)}`);
  }
  if (config.keysManager?.emitErrorOnExtraKeys !== true) {
    problems.push('keysManager.emitErrorOnExtraKeys must be true');
  }
  const inputs = config.keysManager?.input ?? [];
  if (inputs.length === 0) problems.push('keysManager.input is empty');
  for (const input of inputs) {
    if (!existsSync(join(dir, input))) problems.push(`input ${join(dir, input)} does not exist`);
  }
  for (const lang of LANGS) {
    const file = join(dir, config.rootTranslationsPath ?? '', `${lang}.json`);
    if (!existsSync(file)) problems.push(`${file} is missing`);
  }
  // The tool would skip a scope whose folder is missing; every scope needs both language files.
  for (const path of Object.values(config.scopePathMap ?? {})) {
    for (const lang of LANGS) {
      const file = join(dir, path, `${lang}.json`);
      if (!existsSync(file)) problems.push(`${file} is missing`);
    }
  }
  return problems;
}

/** @returns {{ ok: boolean, output: string }} */
export function checkProject(dir) {
  const problems = validateProject(dir);
  if (problems.length > 0) return { ok: false, output: problems.join('\n') };
  const result = spawnSync(CLI, ['find'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const silent = SILENT_FAILURES.some((message) => output.includes(message));
  return { ok: result.status === 0 && !silent, output };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error('Usage: check-translation-keys.mjs <project dir>...');
    process.exit(2);
  }
  let failed = false;
  for (const dir of dirs) {
    const { ok, output } = checkProject(dir);
    console.log(`\n== ${dir}: ${ok ? 'ok' : 'FAILED'}\n${output}`);
    failed ||= !ok;
  }
  process.exit(failed ? 1 : 0);
}
