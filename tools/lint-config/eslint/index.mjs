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
        '**/node_modules/**',
        'tools/lint-config/test/fixture/**',
      ],
    },
    { files: ['**/*.{js,mjs,cjs,ts}'], extends: [js.configs.recommended] },
    { files: ['**/*.{js,mjs,cjs}'], languageOptions: { globals: globals.node } },
    { files: ['**/*.ts'], extends: [tseslint.configs.recommended] },
    ...(typeChecked
      ? [
          {
            files: ['apps/backend/**/*.ts', 'packages/**/*.ts'],
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
      files: ['apps/frontend/src/app/**/*.ts'],
      plugins: { smart: smartPlugin },
      rules: { 'smart/no-component-styles': 'error' },
    },
    {
      files: ['apps/frontend/projects/ui/**/*.ts'],
      plugins: { smart: smartPlugin },
      rules: { 'smart/no-component-styles': ['error', { allowStyleUrl: true }] },
    },
    frontendRestrictedImports(),
    backendBoundaries(),
    frontendBoundaries(),
  ];
}
