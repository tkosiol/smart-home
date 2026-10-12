import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import angular from 'angular-eslint';
import { describe, expect, it } from 'vitest';
import { RuleTester } from 'eslint';
import {
  TEXT_ATTRIBUTES,
  noLiteralTemplateText,
} from '../eslint/rules/no-literal-template-text.mjs';

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
      code: '<ui-list-item headline="Wohnzimmer" />',
      errors: [{ messageId: 'literalAttribute', data: { name: 'headline' } }],
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

/** String inputs of @smart/ui that never carry text for people: identifiers, URLs, form hints. */
const NON_TEXT_STRING_INPUTS = new Set(['autocomplete', 'name', 'route']);

const UI_LIB = join(import.meta.dirname, '../../../apps/frontend/projects/ui/src/lib');
const STRING_INPUT = /readonly (\w+) = input(?:\.required)?<string\b/g;

/** Component sources of the UI library: no stories, specs, or test helpers. */
function componentSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'testing' ? [] : componentSources(path);
    return /\.ts$/.test(entry.name) && !/\.(spec|stories|story-component)\.ts$/.test(entry.name)
      ? [path]
      : [];
  });
}

describe('no-literal-template-text coverage of @smart/ui inputs', () => {
  it('knows every string input of the UI library as text or as explicitly not text', () => {
    const names = componentSources(UI_LIB).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(STRING_INPUT)].map((match) => match[1]),
    );
    // A renamed folder or regex would otherwise turn this into a test of nothing.
    expect(names.length).toBeGreaterThan(10);
    const unknown = [...new Set(names)].filter(
      (name) => !TEXT_ATTRIBUTES.has(name) && !NON_TEXT_STRING_INPUTS.has(name),
    );
    expect(
      unknown,
      'add text inputs to TEXT_ATTRIBUTES, other ones to NON_TEXT_STRING_INPUTS',
    ).toEqual([]);
  });
});
