const AI_ATTRIBUTION =
  /co-authored-by:[^\n]*(claude|anthropic)|generated (with|by)[^\n]*claude|🤖 generated/i;

/** True if a commit message or PR text carries an AI attribution line (repository convention). */
export function hasAiAttribution(text) {
  return AI_ATTRIBUTION.test(text ?? '');
}
