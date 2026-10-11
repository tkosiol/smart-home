/** Components outside @smart/ui must not style themselves; @smart/ui may only use style files. */
export const noComponentStyles = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow component-level styles. Build UI from @smart/ui; add a ui-* component if something is missing.',
    },
    schema: [
      {
        type: 'object',
        properties: { allowStyleUrl: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    messages: {
      noStyles:
        'Components here must not define "{{name}}". Use @smart/ui components and layout primitives instead.',
    },
  },
  create(context) {
    const allowStyleUrl = context.options[0]?.allowStyleUrl ?? false;
    const banned = new Set(allowStyleUrl ? ['styles'] : ['styles', 'styleUrl', 'styleUrls']);

    return {
      'Decorator > CallExpression[callee.name="Component"] > ObjectExpression > Property'(node) {
        const name =
          node.key.type === 'Identifier'
            ? node.key.name
            : node.key.type === 'Literal'
              ? String(node.key.value)
              : undefined;
        if (name !== undefined && banned.has(name)) {
          context.report({ node, messageId: 'noStyles', data: { name } });
        }
      },
    };
  },
};
