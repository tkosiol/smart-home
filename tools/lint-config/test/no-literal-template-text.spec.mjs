import angular from 'angular-eslint';
import { RuleTester } from 'eslint';
import { noLiteralTemplateText } from '../eslint/rules/no-literal-template-text.mjs';

const ruleTester = new RuleTester({ languageOptions: { parser: angular.templateParser } });

ruleTester.run('no-literal-template-text', noLiteralTemplateText, {
  valid: [
    { code: "<p>{{ 'ui.themeEditor.title' | transloco }}</p>" },
    { code: '<p>{{ value() }} · {{ unit() }}</p>' },
    { code: '<span>#</span><span>–</span>' },
    { code: '<ui-icon name="palette" size="sm" />' },
    { code: '<ui-stack gap="md" direction="row" />' },
    { code: '<button type="button" [attr.aria-label]="label()"></button>' },
    { code: '<ui-select [label]="\'ui.themeEditor.variant\' | transloco" />' },
    { code: '<input autocomplete="off" spellcheck="false" />' },
    { code: "<p>{{ ok ? ('ui.a' | transloco) : ('ui.b' | transloco) }}</p>" },
    { code: "<ui-x [label]=\"ok ? ('ui.a' | transloco) : ('ui.b' | transloco)\" />" },
    { code: "<p>{{ 'ui.x' | transloco: { color: name, tone: 'warm' } }}</p>" },
    { code: "@if (mode() === 'personal') { <p>{{ 'ui.x' | transloco }}</p> }" },
  ],
  invalid: [
    { code: '<p>Hallo</p>', errors: [{ messageId: 'literalText' }] },
    { code: '<p>{{ count() }} Geräte</p>', errors: [{ messageId: 'literalText' }] },
    {
      code: '<ui-icon-button aria-label="Schließen" />',
      errors: [{ messageId: 'literalAttribute', data: { name: 'aria-label' } }],
    },
    {
      code: '<ui-section heading="Farben" />',
      errors: [{ messageId: 'literalAttribute', data: { name: 'heading' } }],
    },
    {
      code: '<ui-switch [label]="\'Farbtreue\'" />',
      errors: [{ messageId: 'literalAttribute', data: { name: 'label' } }],
    },
    {
      code: '<button [attr.title]="\'Mehr\'"></button>',
      errors: [{ messageId: 'literalAttribute', data: { name: 'title' } }],
    },
    {
      code: '<ui-x label="Zähler {{ n }}" />',
      errors: [{ messageId: 'literalAttribute', data: { name: 'label' } }],
    },
    { code: "<p>{{ ok ? 'Ja' : 'Nein' }}</p>", errors: [{ messageId: 'literalText' }] },
    { code: "<p>{{ 'Hallo' }}</p>", errors: [{ messageId: 'literalText' }] },
    {
      code: "<ui-x [label]=\"ok ? 'Ja' : 'Nein'\" />",
      errors: [{ messageId: 'literalAttribute', data: { name: 'label' } }],
    },
  ],
});
