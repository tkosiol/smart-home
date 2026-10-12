import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkProject } from '../i18n/check-translation-keys.mjs';

const config = (input = 'src/app') =>
  `module.exports = { rootTranslationsPath: 'src/i18n', langs: ['de', 'en'], keysManager: { input: ['${input}'], unflat: true, emitErrorOnExtraKeys: true } };\n`;

const COMPONENT = `import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { marker } from '@jsverse/transloco-keys-manager/marker';

export const HINT = marker('app.hint');

@Component({ selector: 'app-x', imports: [TranslocoPipe], template: \`<p>{{ 'app.title' | transloco }}</p>\` })
export class X {}
`;

const scopedConfig = (paths = { dashboard: 'src/app/features/dashboard/i18n' }) =>
  `module.exports = { rootTranslationsPath: 'src/i18n', langs: ['de', 'en'], scopePathMap: ${JSON.stringify(paths)}, keysManager: { input: ['src/app'], unflat: true, emitErrorOnExtraKeys: true } };\n`;

const SCOPED_ROUTES = `import { Component } from '@angular/core';
import { TranslocoPipe, provideTranslocoScope } from '@jsverse/transloco';

@Component({
  selector: 'app-dashboard',
  imports: [TranslocoPipe],
  providers: [provideTranslocoScope({ scope: 'dashboard', loader: {} })],
  template: \`<p>{{ 'dashboard.title' | transloco }}</p>\`,
})
export class Dashboard {}
`;

const COMPLETE = { app: { title: 'Titel', hint: 'Hinweis' } };

let created = [];

/** Writes a throwaway project; `null` leaves a file out. */
function project(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-check-'));
  created.push(dir);
  const files = {
    'transloco.config.cjs': config(),
    'src/app/x.ts': COMPONENT,
    'src/i18n/de.json': COMPLETE,
    'src/i18n/en.json': COMPLETE,
    ...overrides,
  };
  for (const [path, content] of Object.entries(files)) {
    if (content === null) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

afterEach(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
  created = [];
});

describe('checkProject', { timeout: 60_000 }, () => {
  it('passes when every used key exists in every language and nothing else does', () => {
    const result = checkProject(project());
    expect(result.output).toContain('No missing keys');
    expect(result.ok).toBe(true);
  });

  it('fails on a key missing in one language, including keys only marked in code', () => {
    const result = checkProject(project({ 'src/i18n/en.json': { app: { title: 'Title' } } }));
    expect(result.ok).toBe(false);
    expect(result.output).toContain('app.hint');
  });

  it('fails on a key no code uses', () => {
    const result = checkProject(
      project({ 'src/i18n/en.json': { app: { title: 'Title', hint: 'Hint', old: 'Old' } } }),
    );
    expect(result.ok).toBe(false);
    expect(result.output).toContain('app.old');
  });

  it('fails instead of passing silently when a language file is missing', () => {
    const result = checkProject(project({ 'src/i18n/en.json': null }));
    expect(result.ok).toBe(false);
    expect(result.output).toContain('en.json');
  });

  it('fails instead of passing silently when the input folder does not exist', () => {
    const result = checkProject(project({ 'transloco.config.cjs': config('src/missing') }));
    expect(result.ok).toBe(false);
    expect(result.output).toContain('src/missing');
  });

  it('fails without a config file', () => {
    const result = checkProject(project({ 'transloco.config.cjs': null }));
    expect(result.ok).toBe(false);
    expect(result.output).toContain('transloco.config.cjs');
  });

  describe('scopes', () => {
    const scoped = (overrides = {}) =>
      project({
        'transloco.config.cjs': scopedConfig(),
        'src/app/features/dashboard/dashboard.ts': SCOPED_ROUTES,
        'src/app/features/dashboard/i18n/de.json': { title: 'Übersicht' },
        'src/app/features/dashboard/i18n/en.json': { title: 'Overview' },
        ...overrides,
      });

    it('passes with a complete scope folder', () => {
      const result = checkProject(scoped());
      expect(result.output).toContain('No missing keys');
      expect(result.ok).toBe(true);
    });

    it('fails when a scope folder from scopePathMap does not exist', () => {
      const result = checkProject(
        scoped({
          'src/app/features/dashboard/i18n/de.json': null,
          'src/app/features/dashboard/i18n/en.json': null,
        }),
      );
      expect(result.ok).toBe(false);
      expect(result.output).toContain('src/app/features/dashboard/i18n');
    });

    it('fails when a scope folder lacks one language file', () => {
      const result = checkProject(scoped({ 'src/app/features/dashboard/i18n/en.json': null }));
      expect(result.ok).toBe(false);
      expect(result.output).toContain('en.json');
    });

    it('fails on a scope key missing in one language', () => {
      const result = checkProject(scoped({ 'src/app/features/dashboard/i18n/en.json': {} }));
      expect(result.ok).toBe(false);
      expect(result.output).toContain('title');
    });
  });
});
