// `@smart/ui/forms` is the second entry (form controls, theme editor), kept apart so that their
// Material code is bundled with the lazy pages that use it, not with the shell.
const PUBLIC_UI_ONLY = 'Import from the public API "@smart/ui" or "@smart/ui/forms" only.';

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
  { group: ['@smart/ui/*', '!@smart/ui/forms'], message: PUBLIC_UI_ONLY },
  { group: ['**/projects/ui/**'], message: PUBLIC_UI_ONLY },
];

const NO_FORMS_IN_THE_SHELL = {
  group: ['@smart/ui/forms'],
  message:
    'core/ and shell/ load at startup: "@smart/ui/forms" (form controls, theme editor) would put ' +
    'its Material code into the initial bundle. Use it only in lazy feature pages.',
};

export function frontendRestrictedImports() {
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
      rules: {
        'no-restricted-imports': [
          'error',
          { paths: PATHS, patterns: [...PATTERNS, NO_FORMS_IN_THE_SHELL] },
        ],
      },
    },
  ];
}
