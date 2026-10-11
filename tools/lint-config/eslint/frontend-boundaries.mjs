import boundaries from 'eslint-plugin-boundaries';

export function frontendBoundaries() {
  return {
    files: ['apps/frontend/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { alwaysTryTypes: true } },
      'boundaries/elements': [
        { type: 'fe-core', pattern: 'apps/frontend/src/app/core/*', capture: ['name'] },
        { type: 'fe-shell', pattern: 'apps/frontend/src/app/shell' },
        { type: 'fe-feature', pattern: 'apps/frontend/src/app/features/*', capture: ['name'] },
        { type: 'fe-app', pattern: 'apps/frontend/src' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            {
              disallow: {
                to: {
                  element: { type: ['fe-core', 'fe-feature'], fileInternalPath: '!index.ts' },
                },
              },
              message: 'Import "{{to.element.captured.name}}" only through its public index.ts',
            },
            {
              from: { element: { type: ['fe-core', 'fe-shell'] } },
              disallow: { to: { element: { type: 'fe-feature' } } },
              message:
                'core/ and shell/ must not depend on features; features register via provideFeature()',
            },
            {
              from: { element: { type: 'fe-feature' } },
              disallow: { to: { element: { type: 'fe-feature' } } },
              message: 'Features must not depend on each other',
            },
          ],
        },
      ],
    },
  };
}
