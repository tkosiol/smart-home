import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findViolations, isAllowed } from '../licenses/check-licenses.mjs';

const cli = fileURLToPath(new URL('../licenses/check-licenses.mjs', import.meta.url));
const run = (input) => spawnSync(process.execPath, [cli], { input, encoding: 'utf8' });

describe('isAllowed', () => {
  it.each([
    'MIT',
    'Apache-2.0',
    'BSD-3-Clause',
    'BlueOak-1.0.0',
    'MPL-2.0',
    '(MIT OR GPL-3.0)',
    '(Apache-2.0 AND BSD-3-Clause)',
    'MIT OR Apache-2.0',
  ])('allows %s', (expression) => {
    expect(isAllowed(expression)).toBe(true);
  });

  it.each([
    'GPL-2.0-only',
    'SSPL-1.0',
    'BUSL-1.1',
    'Unknown',
    '',
    '(MIT AND SSPL-1.0)',
    'Commons-Clause',
  ])('rejects %j', (expression) => {
    expect(isAllowed(expression)).toBe(false);
  });
});

describe('findViolations', () => {
  it('reports every package under a disallowed license', () => {
    const report = {
      MIT: [{ name: 'ok-lib' }],
      'SSPL-1.0': [{ name: 'mongo-thing' }, { name: 'other' }],
      Unknown: [{ name: 'mystery' }],
    };
    expect(findViolations(report)).toEqual([
      { license: 'SSPL-1.0', packages: ['mongo-thing', 'other'] },
      { license: 'Unknown', packages: ['mystery'] },
    ]);
  });

  it('accepts AGPL-3.0-only only for our own packages', () => {
    expect(findViolations({ 'AGPL-3.0-only': [{ name: '@smart/backend' }] })).toEqual([]);
    expect(findViolations({ 'AGPL-3.0-only': [{ name: 'foreign-agpl-lib' }] })).toEqual([
      { license: 'AGPL-3.0-only', packages: ['foreign-agpl-lib'] },
    ]);
  });
});

describe('check-licenses CLI', () => {
  it('passes a clean report', () => {
    const result = run(JSON.stringify({ MIT: [{ name: 'a' }, { name: 'b' }] }));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('licenses ok (2 packages)');
  });

  it('fails and names the offending packages', () => {
    const result = run(JSON.stringify({ 'GPL-2.0-only': [{ name: 'gpl-lib' }] }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('gpl-lib');
  });

  it.each(['', 'not json', '{}', '[]'])(
    'fails on unusable input %j instead of reporting ok',
    (input) => {
      expect(run(input).status).toBe(1);
    },
  );
});
