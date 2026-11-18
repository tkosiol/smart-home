import boundaries from 'eslint-plugin-boundaries';

export function backendBoundaries() {
  return {
    files: ['apps/backend/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { alwaysTryTypes: true } },
      'boundaries/elements': [
        { type: 'be-platform', pattern: 'apps/backend/src/platform/*', capture: ['name'] },
        { type: 'be-core', pattern: 'apps/backend/src/core/*', capture: ['name'] },
        { type: 'be-module', pattern: 'apps/backend/src/modules/*', capture: ['name'] },
        { type: 'be-adapter', pattern: 'apps/backend/src/adapters/*', capture: ['name'] },
        { type: 'be-app', pattern: 'apps/backend/src' },
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
                  element: {
                    type: ['be-platform', 'be-core', 'be-module', 'be-adapter'],
                    fileInternalPath: '!index.ts',
                  },
                },
              },
              message: 'Import "{{to.element.captured.name}}" only through its public index.ts',
            },
            {
              from: { element: { type: 'be-platform' } },
              disallow: { to: { element: { type: ['be-core', 'be-module', 'be-adapter'] } } },
              message: 'platform/* must not depend on core/*, modules/* or adapters/*',
            },
            {
              from: { element: { type: 'be-core' } },
              disallow: { to: { element: { type: 'be-module' } } },
              message: 'core/* must not depend on feature modules',
            },
            {
              from: { element: { type: 'be-core' } },
              disallow: { to: { element: { type: 'be-adapter' } } },
              message: 'core/* must not depend on gateway adapters',
            },
            {
              from: { element: { type: 'be-module' } },
              disallow: { to: { element: { type: 'be-module' } } },
              message: 'Feature modules must not depend on each other; use core domain events',
            },
            {
              from: { element: { type: 'be-module' } },
              disallow: { to: { element: { type: 'be-adapter' } } },
              message: 'Feature modules must not depend on gateway adapters',
            },
            {
              from: { element: { type: 'be-adapter' } },
              disallow: { to: { element: { type: 'be-adapter' } } },
              message: 'Gateway adapters must not depend on each other',
            },
            {
              from: { element: { type: 'be-adapter' } },
              disallow: { to: { element: { type: 'be-module' } } },
              message: 'Gateway adapters must not depend on feature modules',
            },
          ],
        },
      ],
    },
  };
}
