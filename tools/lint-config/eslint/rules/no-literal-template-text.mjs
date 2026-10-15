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
  'headline',
  'hint',
  'invalidMessage',
  'label',
  'navigationLabel',
  'pickerLabel',
  'placeholder',
  'supporting',
  'title',
  'trailingText',
]);

/**
 * Inputs of components that carry text but share their name with a plain HTML attribute
 * (`<option value>`, `<input value>`): text only on custom elements (`ui-*`, `app-*`), so HTML
 * keeps its values.
 */
export const UI_TEXT_INPUTS = new Set(['unit', 'value', 'valueText']);

/** True for an attribute of a custom element; native HTML element names have no hyphen. */
function onCustomElement(attribute) {
  return (attribute.parent?.name ?? '').includes('-');
}

function isTextAttribute(attribute) {
  return (
    TEXT_ATTRIBUTES.has(attribute.name) ||
    (UI_TEXT_INPUTS.has(attribute.name) && onCustomElement(attribute))
  );
}

/** Operators whose operands end up in the output (`a ?? 'x'`, `'Hello ' + name`); comparisons do not. */
const VALUE_OPERATORS = new Set(['+', '??', '||', '&&']);

/**
 * True when the expression can produce visible text from a literal. Only value positions are
 * followed (conditional branches, pipe input, concatenation, parentheses, template literals), so
 * comparisons, call arguments and pipe parameters stay allowed. The direct input of the `transloco`
 * pipe is a key, not text.
 */
function hasLiteralText(ast) {
  if (!ast || typeof ast !== 'object') return false;
  switch (ast.constructor?.name) {
    case 'ASTWithSource':
      return hasLiteralText(ast.ast);
    case 'Interpolation':
      return (
        LETTER.test(ast.strings.join('')) || ast.expressions.some((item) => hasLiteralText(item))
      );
    case 'LiteralPrimitive':
      return typeof ast.value === 'string' && LETTER.test(ast.value);
    case 'Conditional':
      return hasLiteralText(ast.trueExp) || hasLiteralText(ast.falseExp);
    case 'BindingPipe':
      return ast.name !== 'transloco' && hasLiteralText(ast.exp);
    case 'Binary':
      return (
        VALUE_OPERATORS.has(ast.operation) &&
        (hasLiteralText(ast.left) || hasLiteralText(ast.right))
      );
    case 'ParenthesizedExpression':
    case 'NonNullAssert':
      return hasLiteralText(ast.expression);
    case 'TemplateLiteral':
      return (
        ast.elements.some((element) => LETTER.test(element.text)) ||
        ast.expressions.some((item) => hasLiteralText(item))
      );
    default:
      return false;
  }
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
        if (hasLiteralText(node.value)) report(node, 'literalText');
      },
      TextAttribute(node) {
        if (isTextAttribute(node) && LETTER.test(node.value)) {
          report(node, 'literalAttribute', { name: node.name });
        }
      },
      BoundAttribute(node) {
        if (isTextAttribute(node) && hasLiteralText(node.value)) {
          report(node, 'literalAttribute', { name: node.name });
        }
      },
    };
  },
};
