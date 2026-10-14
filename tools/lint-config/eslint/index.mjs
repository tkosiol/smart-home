import js from '@eslint/js';
import angular from 'angular-eslint';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { backendBoundaries } from './backend-boundaries.mjs';
import { frontendBoundaries } from './frontend-boundaries.mjs';
import { frontendRestrictedImports } from './frontend-restricted-imports.mjs';
import { smartPlugin } from './plugin.mjs';

/**
 * Complete ESLint flat config for the monorepo. Wrap with `defineConfig()`.
 * @param {{ rootDir: string, typeChecked?: boolean }} options
 */
export function smartConfig({ rootDir, typeChecked = true }) {
  return [
    {
      ignores: [
        '**/dist/**',
        '**/coverage/**',
        '**/.angular/**',
        '**/storybook-static/**',
        '**/node_modules/**',
        'tools/lint-config/test/fixture/**',
      ],
    },
    { files: ['**/*.{js,mjs,cjs,ts}'], extends: [js.configs.recommended] },
    { files: ['**/*.{js,mjs,cjs}'], languageOptions: { globals: globals.node } },
    {
      // Classic scripts served as-is from the app's public folder (e.g. theme-boot.js).
      files: ['apps/frontend/public/**/*.js'],
      languageOptions: { sourceType: 'script', globals: globals.browser },
    },
    { files: ['**/*.ts'], extends: [tseslint.configs.recommended] },
    ...(typeChecked
      ? [
          {
            files: ['apps/backend/**/*.ts', 'apps/gateway-simulator/**/*.ts', 'packages/**/*.ts'],
            extends: [tseslint.configs.recommendedTypeChecked],
            languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: rootDir } },
          },
        ]
      : []),
    {
      files: ['apps/frontend/**/*.ts'],
      extends: [angular.configs.tsRecommended],
      processor: angular.processInlineTemplates,
      rules: {
        '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      },
    },
    {
      files: ['apps/frontend/src/**/*.ts'],
      rules: {
        '@angular-eslint/component-selector': [
          'error',
          { type: 'element', prefix: 'app', style: 'kebab-case' },
        ],
        '@angular-eslint/directive-selector': [
          'error',
          { type: 'attribute', prefix: 'app', style: 'camelCase' },
        ],
      },
    },
    {
      files: ['apps/frontend/projects/ui/**/*.ts'],
      rules: {
        '@angular-eslint/component-selector': [
          'error',
          { type: 'element', prefix: 'ui', style: 'kebab-case' },
        ],
        '@angular-eslint/directive-selector': [
          'error',
          { type: 'attribute', prefix: 'ui', style: 'camelCase' },
        ],
      },
    },
    {
      files: ['apps/frontend/**/*.html'],
      extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    },
    {
      // Spec 7: no visible text without a translation key. Inline templates are linted as
      // virtual files below their .ts file; stories and specs may use German sample texts.
      // index.html is the static shell document (brand name in <title>), not a component template.
      files: ['apps/frontend/**/*.html'],
      ignores: [
        '**/*.stories.ts/**',
        '**/*.spec.ts/**',
        '**/testing/**',
        '**/*.story-component.html',
        'apps/frontend/src/index.html',
      ],
      plugins: { smart: smartPlugin },
      rules: { 'smart/no-literal-template-text': 'error' },
    },
    {
      files: ['apps/frontend/src/app/**/*.ts'],
      plugins: { smart: smartPlugin },
      rules: { 'smart/no-component-styles': 'error' },
    },
    {
      files: ['apps/frontend/projects/ui/**/*.ts'],
      plugins: { smart: smartPlugin },
      rules: { 'smart/no-component-styles': ['error', { allowStyleUrl: true }] },
    },
    {
      files: [
        'apps/backend/src/core/*.ts',
        'apps/backend/src/modules/*.ts',
        'apps/backend/src/platform/*.ts',
        'apps/frontend/src/app/core/*.ts',
        'apps/frontend/src/app/features/*.ts',
      ],
      plugins: { smart: smartPlugin },
      rules: { 'smart/no-loose-files': 'error' },
    },
    ...frontendRestrictedImports(),
    backendBoundaries(),
    frontendBoundaries(),
  ];
}
