import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// @smart/ui has three entries: `@smart/ui/shell` (eager part, for startup code), `@smart/ui` (the
// barrel: shell plus everything else, for lazy pages) and `@smart/ui/forms` (form controls, theme
// editor). They are kept apart so that code only lazy pages use is bundled with those pages.
const PUBLIC_UI_ONLY =
  'Import from the public API "@smart/ui", "@smart/ui/shell" or "@smart/ui/forms" only.';

const PATHS = [
  {
    name: '@angular/common',
    importNames: ['DatePipe', 'CommonModule', 'formatDate'],
    message: 'Use the time-zone-aware pipes from @smart/ui (spec §9).',
  },
];

const PATTERNS = [
  {
    group: ['@angular/material', '@angular/material/*', '@angular/cdk', '@angular/cdk/*'],
    message: 'Angular Material/CDK are internal to @smart/ui. Use or add a ui-* component.',
  },
  {
    group: ['@smart/ui/*', '!@smart/ui/forms', '!@smart/ui/shell', '!@smart/ui/testing'],
    message: PUBLIC_UI_ONLY,
  },
  { group: ['**/projects/ui/**'], message: PUBLIC_UI_ONLY },
];

// `@smart/ui/testing` holds stand-ins for specs (a chart engine that draws nothing, say). Only
// specs and the app's test helpers may import it, so none of it can end up in a bundle.
const TESTING_IN_SPECS_ONLY = {
  group: ['@smart/ui/testing'],
  message:
    '"@smart/ui/testing" holds stand-ins for specs: import it in *.spec.ts files and in ' +
    'src/app/testing/ only.',
};

// A barrel that startup code imports pulls in every file it re-exports that is used anywhere,
// lazy pages' components included (esbuild assigns whole files to the chunk main reaches).
const ONLY_THE_SHELL_ENTRY = {
  name: '@smart/ui',
  message:
    'core/, shell/ and the app root load at startup: import from "@smart/ui/shell" (the eager ' +
    'part), not from the "@smart/ui" barrel, or components only lazy pages use land in the ' +
    'initial bundle.',
};

const NO_FORMS_IN_THE_SHELL = {
  group: ['@smart/ui/forms'],
  message:
    'core/ and shell/ load at startup: "@smart/ui/forms" (form controls, theme editor) would put ' +
    'its Material code into the initial bundle. Use it only in lazy feature pages.',
};

const MATERIAL = {
  group: ['@angular/material', '@angular/material/*', '@angular/cdk', '@angular/cdk/*'],
  message:
    'This file is part of "@smart/ui/shell" and loads at startup: build it without Angular ' +
    'Material/CDK, or load them on demand with import() (ADR-0011, addendum 2026-10-27).',
};

const SHELL_ENTRY = 'apps/frontend/projects/ui/src/shell.ts';

const STATIC_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s(?!type\s)[^;]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g;

/**
 * The files the eager entry `@smart/ui/shell` loads, relative to the repository root: everything
 * shell.ts reaches through static relative imports and re-exports (type-only ones are skipped, they
 * are not bundled). import() is not followed, so a
 * file loaded on demand stays outside.
 */
function shellEntryFiles(rootDir) {
  const entry = path.join(rootDir, SHELL_ENTRY);
  if (!existsSync(entry))
    throw new Error(`lint config: the eager UI entry ${SHELL_ENTRY} is missing`);
  const found = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    for (const [, specifier] of readFileSync(file, 'utf8').matchAll(STATIC_IMPORT)) {
      const base = path.resolve(path.dirname(file), specifier);
      const target = [`${base}.ts`, path.join(base, 'index.ts')].find((f) => existsSync(f));
      if (!target || found.has(target)) continue;
      found.add(target);
      pending.push(target);
    }
  }
  if (found.size === 0) throw new Error(`lint config: ${SHELL_ENTRY} re-exports no files`);
  return [...found].map((file) => path.relative(rootDir, file).split(path.sep).join('/'));
}

/** @param {{ rootDir: string }} options */
export function frontendRestrictedImports({ rootDir }) {
  const shellFiles = shellEntryFiles(rootDir);
  return [
    {
      files: ['apps/frontend/src/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          { paths: PATHS, patterns: [...PATTERNS, TESTING_IN_SPECS_ONLY] },
        ],
      },
    },
    {
      // A later config replaces the rule's options, so the general ones are repeated.
      files: [
        'apps/frontend/src/app/*.ts',
        'apps/frontend/src/app/core/**/*.ts',
        'apps/frontend/src/app/shell/**/*.ts',
      ],
      // Specs are not bundled. shell/not-found.ts is a lazy page that merely lives in shell/.
      ignores: ['**/*.spec.ts', 'apps/frontend/src/app/shell/not-found.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [...PATHS, ONLY_THE_SHELL_ENTRY],
            patterns: [...PATTERNS, TESTING_IN_SPECS_ONLY, NO_FORMS_IN_THE_SHELL],
          },
        ],
      },
    },
    {
      // Specs and the test helpers are never bundled: they may use the stand-ins.
      files: ['apps/frontend/src/**/*.spec.ts', 'apps/frontend/src/app/testing/**/*.ts'],
      rules: { 'no-restricted-imports': ['error', { paths: PATHS, patterns: PATTERNS }] },
    },
    {
      // import() is no import declaration: loading Material on demand stays allowed.
      files: shellFiles,
      rules: { 'no-restricted-imports': ['error', { patterns: [MATERIAL] }] },
    },
  ];
}
