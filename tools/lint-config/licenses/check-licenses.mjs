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
const OWN_LICENSE = 'AGPL-3.0-only';
const isOwnPackage = (name) => name === 'smart-home' || name.startsWith('@smart/');

/** SPDX subset: identifiers combined with OR / AND, optionally in one pair of parentheses. */
export function isAllowed(expression) {
  const trimmed = (expression ?? '').trim().replace(/^\((.*)\)$/, '$1');
  if (trimmed === '') return false;
  if (/\sOR\s/.test(trimmed)) return trimmed.split(/\s+OR\s+/).some((part) => isAllowed(part));
  if (/\sAND\s/.test(trimmed)) return trimmed.split(/\s+AND\s+/).every((part) => isAllowed(part));
  return ALLOWED.has(trimmed);
}

export function findViolations(report) {
  const violations = [];
  for (const [license, packages] of Object.entries(report)) {
    const offending = packages
      .map((pkg) => pkg.name)
      .filter((name) => !(isAllowed(license) || (license === OWN_LICENSE && isOwnPackage(name))));
    if (offending.length > 0) violations.push({ license, packages: offending });
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
