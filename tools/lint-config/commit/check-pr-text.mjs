#!/usr/bin/env node
// CI check: the PR title and body become the squash commit on main, so they must not carry AI attribution.
import { hasAiAttribution } from './no-ai-attribution.mjs';

const text = `${process.env.PR_TITLE ?? ''}\n\n${process.env.PR_BODY ?? ''}`;

if (hasAiAttribution(text)) {
  console.error(
    'PR title or body contains an AI attribution line (repository convention, see CLAUDE.md).',
  );
  process.exit(1);
}
console.log('PR text OK');
