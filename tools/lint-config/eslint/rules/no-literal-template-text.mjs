const LETTER = /\p{L}/u;

/** Attributes and inputs whose value is shown or read aloud; a literal there is untranslated text. */
export const TEXT_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'description',
  'error',
  'heading',
  'hint',
  'invalidMessage',
  'label',
  'pickerLabel',
  'placeholder',
  'supporting',
  'title',
  'trailingText',
]);

/** A quoted literal in a binding (`[label]="'Text'"`) is a string-valued LiteralPrimitive. */
function literalString(value) {
  const ast = value?.ast ?? value;
  return typeof ast?.value === 'string' ? ast.value : null;
}

/** Spec 7: no visible text without a translation key. Templates only, stories and specs excluded by config. */
export const noLiteralTemplateText = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow visible text in templates that does not come from a translation key.',
    },
    schema: [],
    messages: {
      literalText:
        "Visible text must come from a translation key ('key' | transloco), not a literal.",
      literalAttribute:
        'The attribute "{{name}}" carries visible text; bind a translated value instead of a literal.',
    },
  },
  create(context) {
    const report = (node, messageId, data) =>
      context.report({
        loc: context.sourceCode.parserServices.convertNodeSourceSpanToLoc(node.sourceSpan),
        messageId,
        data,
      });
    return {
      Text(node) {
        if (LETTER.test(node.value)) report(node, 'literalText');
      },
      BoundText(node) {
        const strings = node.value?.ast?.strings ?? [];
        if (LETTER.test(strings.join(''))) report(node, 'literalText');
      },
      TextAttribute(node) {
        if (TEXT_ATTRIBUTES.has(node.name) && LETTER.test(node.value)) {
          report(node, 'literalAttribute', { name: node.name });
        }
      },
      BoundAttribute(node) {
        const value = literalString(node.value);
        if (TEXT_ATTRIBUTES.has(node.name) && value !== null && LETTER.test(value)) {
          report(node, 'literalAttribute', { name: node.name });
        }
      },
    };
  },
};
