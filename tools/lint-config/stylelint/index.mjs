import { fileURLToPath } from 'node:url';
import strictValue from 'stylelint-declaration-strict-value';

const TOKEN_ONLY_PROPERTIES = [
  '/color$/',
  'fill',
  'stroke',
  'background',
  'box-shadow',
  '/^(margin|padding)/',
  'gap',
  'row-gap',
  'column-gap',
  '/^border(-.*)?-radius$/',
  'font-size',
  'font-weight',
  'font-family',
  'line-height',
  'z-index',
  '/^(transition|animation)-duration$/',
];

export default {
  extends: [fileURLToPath(import.meta.resolve('stylelint-config-standard-scss'))],
  plugins: [strictValue],
  ignoreFiles: [
    '**/dist/**',
    '**/.angular/**',
    '**/storybook-static/**',
    'apps/frontend/projects/ui/src/lib/tokens/**',
  ],
  rules: {
    // kebab-case, plus one BEM-style modifier (".ui-stack--wrap") for host state classes.
    'selector-class-pattern': [
      '^[a-z][a-z0-9]*(-[a-z0-9]+)*(--[a-z0-9]+(-[a-z0-9]+)*)?$',
      { message: (selector) => `Expected class selector "${selector}" to be kebab-case` },
    ],
    'unit-disallowed-list': ['px', 'rem', 'em', 'pt', 'ms', 's'],
    'scss/no-dollar-variables': true,
    'property-disallowed-list': ['/^--/'],
    'selector-disallowed-list': ['/\\.mat-/', '/\\.mdc-/', '/::ng-deep/'],
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': [
      'rgb',
      'rgba',
      'hsl',
      'hsla',
      'hwb',
      'lab',
      'lch',
      'oklab',
      'oklch',
      'color',
    ],
    'scale-unlimited/declaration-strict-value': [
      TOKEN_ONLY_PROPERTIES,
      {
        ignoreValues: [
          'inherit',
          'initial',
          'unset',
          'currentcolor',
          'transparent',
          'none',
          'auto',
          '0',
          'normal',
        ],
        disableFix: true,
      },
    ],
  },
};
