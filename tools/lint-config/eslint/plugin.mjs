import { noComponentStyles } from './rules/no-component-styles.mjs';
import { noLiteralTemplateText } from './rules/no-literal-template-text.mjs';
import { noLooseFiles } from './rules/no-loose-files.mjs';

export const smartPlugin = {
  meta: { name: '@smart/eslint-plugin' },
  rules: {
    'no-component-styles': noComponentStyles,
    'no-literal-template-text': noLiteralTemplateText,
    'no-loose-files': noLooseFiles,
  },
};
