import { noComponentStyles } from './rules/no-component-styles.mjs';
import { noLooseFiles } from './rules/no-loose-files.mjs';

export const smartPlugin = {
  meta: { name: '@smart/eslint-plugin' },
  rules: {
    'no-component-styles': noComponentStyles,
    'no-loose-files': noLooseFiles,
  },
};
