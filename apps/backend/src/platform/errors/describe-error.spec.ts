import { describe, expect, it } from 'vitest';
import { describeError, stackFrames } from './describe-error.js';

describe('describeError', () => {
  it('names the class and the code of the error or its cause', () => {
    const cause = Object.assign(new Error('x'), { code: 'ECONNREFUSED' });
    expect(describeError(new Error('secret', { cause }))).toBe('Error ECONNREFUSED');
    expect(describeError(new TypeError('secret'))).toBe('TypeError');
  });

  it('prefers the most specific class over a generic name, also from the cause', () => {
    class DriverError extends Error {}
    class WrapperError extends Error {}
    const failure = new WrapperError('select ... params: till@example.org', {
      cause: Object.assign(new DriverError('x'), { code: '23505' }),
    });
    expect(describeError(failure)).toBe('DriverError 23505');
    expect(describeError(new WrapperError('x', { cause: new Error('y') }))).toBe('WrapperError');
  });

  it('ignores names and codes that are not plain words and non-Error values', () => {
    const odd = Object.assign(new Error('x'), { name: 'a@example.org', code: 'till@example.org' });
    expect(describeError(odd)).toBe('Error');
    expect(describeError('till@example.org')).toBe('non-Error value');
  });
});

describe('stackFrames', () => {
  it('returns the frames without the (multi-line) message', () => {
    const error = new Error('line one\nline two\n    at fake (message.ts:1:1)');
    error.stack = `Error: line one\nline two\n    at real (a.ts:1:1)\n    at other (b.ts:2:2)`;
    expect(stackFrames(error)).toBe('    at real (a.ts:1:1)\n    at other (b.ts:2:2)');
  });

  it('is undefined without a stack or a frame', () => {
    expect(stackFrames('x')).toBeUndefined();
    const bare = new Error('secret');
    bare.stack = 'Error: secret';
    expect(stackFrames(bare)).toBeUndefined();
  });
});
