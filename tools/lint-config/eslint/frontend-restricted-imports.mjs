// `@smart/ui/forms` is the second entry (form controls, theme editor), kept apart so that their
// Material code is bundled with the lazy pages that use it, not with the shell.
const PUBLIC_UI_ONLY = 'Import from the public API "@smart/ui" or "@smart/ui/forms" only.';

export function frontendRestrictedImports() {
  return {
    files: ['apps/frontend/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@angular/common',
              importNames: ['DatePipe', 'CommonModule', 'formatDate'],
              message: 'Use the time-zone-aware pipes from @smart/ui (spec §9).',
            },
          ],
          patterns: [
            {
              group: ['@angular/material', '@angular/material/*', '@angular/cdk', '@angular/cdk/*'],
              message:
                'Angular Material/CDK are internal to @smart/ui. Use or add a ui-* component.',
            },
            { group: ['@smart/ui/*', '!@smart/ui/forms'], message: PUBLIC_UI_ONLY },
            { group: ['**/projects/ui/**'], message: PUBLIC_UI_ONLY },
          ],
        },
      ],
    },
  };
}
