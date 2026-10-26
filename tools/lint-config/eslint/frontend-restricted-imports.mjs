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
  { group: ['@smart/ui/*', '!@smart/ui/forms', '!@smart/ui/shell'], message: PUBLIC_UI_ONLY },
  { group: ['**/projects/ui/**'], message: PUBLIC_UI_ONLY },
];

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

/** The files `@smart/ui/shell` re-exports, relative to the repository root. */
function shellEntryFiles(rootDir) {
  const entry = path.join(rootDir, SHELL_ENTRY);
  if (!existsSync(entry)) return [];
  const source = readFileSync(entry, 'utf8');
  return [...source.matchAll(/from '\.\/(lib\/[^']+)'/g)].map(
    ([, file]) => `${path.posix.dirname(SHELL_ENTRY)}/${file}.ts`,
  );
}

/** @param {{ rootDir: string }} options */
export function frontendRestrictedImports({ rootDir }) {
  const shellFiles = shellEntryFiles(rootDir);
  return [
    {
      files: ['apps/frontend/src/**/*.ts'],
      rules: { 'no-restricted-imports': ['error', { paths: PATHS, patterns: PATTERNS }] },
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
            patterns: [...PATTERNS, NO_FORMS_IN_THE_SHELL],
          },
        ],
      },
    },
    ...(shellFiles.length === 0
      ? []
      : [
          {
            // import() is no import declaration: loading Material on demand stays allowed.
            files: shellFiles,
            rules: { 'no-restricted-imports': ['error', { patterns: [MATERIAL] }] },
          },
        ]),
  ];
}
