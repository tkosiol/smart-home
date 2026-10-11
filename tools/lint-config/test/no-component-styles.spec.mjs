import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { noComponentStyles } from '../eslint/rules/no-component-styles.mjs';

const ruleTester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

ruleTester.run('no-component-styles', noComponentStyles, {
  valid: [
    { code: "@Component({ selector: 'app-x', template: '' }) class X {}" },
    {
      code: "@Component({ selector: 'ui-x', template: '', styleUrl: './x.scss' }) class X {}",
      options: [{ allowStyleUrl: true }],
    },
    { code: "@Directive({ selector: '[appX]', styles: [] }) class X {}" },
  ],
  invalid: [
    {
      code: "@Component({ selector: 'app-x', template: '', styles: [':host{}'] }) class X {}",
      errors: [{ messageId: 'noStyles', data: { name: 'styles' } }],
    },
    {
      code: "@Component({ selector: 'app-x', template: '', styleUrl: './x.scss' }) class X {}",
      errors: [{ messageId: 'noStyles', data: { name: 'styleUrl' } }],
    },
    {
      code: "@Component({ selector: 'app-x', template: '', styleUrls: ['./x.scss'] }) class X {}",
      errors: [{ messageId: 'noStyles', data: { name: 'styleUrls' } }],
    },
    {
      code: "@Component({ selector: 'ui-x', template: '', styles: ':host{}' }) class X {}",
      options: [{ allowStyleUrl: true }],
      errors: [{ messageId: 'noStyles', data: { name: 'styles' } }],
    },
  ],
});
