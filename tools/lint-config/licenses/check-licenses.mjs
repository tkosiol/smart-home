#!/usr/bin/env node
// Fails CI when a dependency's license is not compatible with this AGPL-3.0-only project.
// Input: `pnpm licenses list --json -r` on stdin.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'Apache-2.0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'Unlicense',
  'CC0-1.0',
  'Python-2.0',
  'MPL-2.0',
  'CC-BY-4.0',
]);
/**
 * Evaluates an SPDX license expression against the allowlist.
 * Grammar: or := and ("OR" and)* ; and := atom ("AND" atom)* ; atom := "(" or ")" | id.
 * "WITH <exception>" and anything unparsable are rejected (fail closed).
 */
export function isAllowed(expression) {
  const tokens = (expression ?? '').match(/\(|\)|[^\s()]+/g) ?? [];
  let position = 0;
  const peek = () => tokens[position];
  const fail = () => {
    throw new Error('unparsable license expression');
  };

  function parseOr() {
    let allowed = parseAnd();
    while (peek() === 'OR') {
      position += 1;
      allowed = parseAnd() || allowed;
    }
    return allowed;
  }

  function parseAnd() {
    let allowed = parseAtom();
    while (peek() === 'AND') {
      position += 1;
      allowed = parseAtom() && allowed;
    }
    return allowed;
  }

  function parseAtom() {
    const token = tokens[position];
    position += 1;
    if (token === '(') {
      const allowed = parseOr();
      if (tokens[position] !== ')') fail();
      position += 1;
      return allowed;
    }
    if (token === undefined || token === ')' || ['OR', 'AND', 'WITH'].includes(token)) fail();
    if (peek() === 'WITH') fail();
    return ALLOWED.has(token);
  }

  try {
    const allowed = parseOr();
    return position === tokens.length && allowed;
  } catch {
    return false;
  }
}

export function findViolations(report) {
  const violations = [];
  for (const [license, packages] of Object.entries(report)) {
    if (!isAllowed(license))
      violations.push({ license, packages: packages.map((pkg) => pkg.name) });
  }
  return violations;
}

function countPackages(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return 0;
  return Object.values(report).reduce(
    (sum, packages) => sum + (Array.isArray(packages) ? packages.length : 0),
    0,
  );
}

function main() {
  let report;
  try {
    report = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    console.error('check-licenses: input is not the JSON output of `pnpm licenses list --json -r`');
    process.exit(1);
  }
  const total = countPackages(report);
  if (total === 0) {
    console.error('check-licenses: report contains no packages – refusing to report ok');
    process.exit(1);
  }
  const violations = findViolations(report);
  if (violations.length > 0) {
    for (const { license, packages } of violations) {
      console.error(`license not allowed: ${license} – ${packages.join(', ')}`);
    }
    process.exit(1);
  }
  console.log(`licenses ok (${total} packages)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
