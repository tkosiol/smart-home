import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import angular from 'angular-eslint';
import { describe, expect, it } from 'vitest';
import { RuleTester } from 'eslint';
import {
  TEXT_ATTRIBUTES,
  UI_TEXT_INPUTS,
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
    // `value` is text only on ui-* elements: a number is fine, and plain HTML keeps its value.
    { code: '<ui-value-display value="18" unit="%" />' },
    { code: '<ui-value-display [value]="reading()" [unit]="unit()" />' },
    { code: '<option value="kitchen"></option>' },
    { code: '<input type="hidden" value="token" />' },
    { code: '<button type="submit" value="send"></button>' },
    // The ids and routes of ui-* elements are no text.
    { code: '<ui-text-field describedBy="state" />' },
    { code: '<ui-page backRoute="/geraete" />' },
  ],
  invalid: [
    { code: '<p>Hallo</p>', errors: [{ messageId: 'literalText' }] },
    {
      code: '<ui-device-hero note="Aktualisiert" />',
      errors: [{ messageId: 'literalAttribute', data: { name: 'note' } }],
    },
    {
      code: '<ui-status-chip text="Standard" />',
      errors: [{ messageId: 'literalAttribute', data: { name: 'text' } }],
    },
    {
      code: '<ui-page backLabel="Zurück" />',
      errors: [{ messageId: 'literalAttribute', data: { name: 'backLabel' } }],
    },
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
    {
      code: '<ui-value-display value="Gut" />',
      errors: [{ messageId: 'literalAttribute', data: { name: 'value' } }],
    },
    {
      code: '<ui-value-display [value]="\'Aus\'" />',
      errors: [{ messageId: 'literalAttribute', data: { name: 'value' } }],
    },
    // Feature components (`app-*`) are custom elements too: their text inputs count as text.
    {
      code: '<app-device-reading value="Aus" />',
      errors: [{ messageId: 'literalAttribute', data: { name: 'value' } }],
    },
    // A unit is visible text too: "°C" or "min" belong to the reading (bound from the data) or to a
    // key, since units like "h" or "Tage" differ by language.
    {
      code: '<ui-value-display unit="°C" />',
      errors: [{ messageId: 'literalAttribute', data: { name: 'unit' } }],
    },
    {
      code: '<ui-progress-band valueText="zu trocken" />',
      errors: [{ messageId: 'literalAttribute', data: { name: 'valueText' } }],
    },
    { code: "<p>{{ 'Hallo' }}</p>", errors: [{ messageId: 'literalText' }] },
    {
      code: "<ui-x [label]=\"ok ? 'Ja' : 'Nein'\" />",
      errors: [{ messageId: 'literalAttribute', data: { name: 'label' } }],
    },
  ],
});

/** String inputs of @smart/ui that never carry text for people: identifiers, URLs, form hints. */
const NON_TEXT_STRING_INPUTS = new Set([
  'autocomplete',
  'backRoute',
  'describedBy',
  'moreRoute',
  'name',
  'route',
  'timeZone',
]);

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
      (name) =>
        !TEXT_ATTRIBUTES.has(name) &&
        !UI_TEXT_INPUTS.has(name) &&
        !NON_TEXT_STRING_INPUTS.has(name),
    );
    expect(
      unknown,
      'add text inputs to TEXT_ATTRIBUTES (or UI_TEXT_INPUTS when the name is a plain HTML attribute too), other ones to NON_TEXT_STRING_INPUTS',
    ).toEqual([]);
  });
});
