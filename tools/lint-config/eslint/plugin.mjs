import { noComponentStyles } from './rules/no-component-styles.mjs';

export const smartPlugin = {
  meta: { name: '@smart/eslint-plugin' },
  rules: {
    'no-component-styles': noComponentStyles,
  },
};
