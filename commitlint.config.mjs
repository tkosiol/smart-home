import { hasAiAttribution } from '@smart/lint-config/commit';

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-ai-attribution': ({ raw }) => [
          !hasAiAttribution(raw),
          'remove AI attribution lines (repository convention, see CLAUDE.md)',
        ],
      },
    },
  ],
  rules: {
    'no-ai-attribution': [2, 'always'],
    'scope-enum': [
      2,
      'always',
      [
        'repo',
        'frontend',
        'backend',
        'contracts',
        'ui',
        'lint',
        'infra',
        'gateway',
        'ci',
        'docs',
        'deps',
        'deps-dev',
      ],
    ],
  },
};
