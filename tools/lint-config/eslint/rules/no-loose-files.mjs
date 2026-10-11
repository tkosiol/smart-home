/** Files directly inside core/, modules/ or features/ would bypass the boundary rules. */
export const noLooseFiles = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow files directly in container folders; every module lives in its own folder with an index.ts.',
    },
    schema: [],
    messages: {
      looseFile:
        'Files must not live directly in this folder. Create a module folder with an index.ts instead.',
    },
  },
  create(context) {
    return {
      Program(node) {
        context.report({ node, messageId: 'looseFile' });
      },
    };
  },
};
