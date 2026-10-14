import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES, apiErrorSchema } from './api-error.js';

describe('apiErrorSchema', () => {
  it('accepts an error without params', () => {
    expect(apiErrorSchema.safeParse({ code: 'auth.required', traceId: 'abc' }).success).toBe(true);
  });

  it('accepts string and number params', () => {
    const parsed = apiErrorSchema.safeParse({
      code: 'auth.rateLimited',
      params: { retryAfterSeconds: 30, scope: 'email' },
      traceId: 'abc',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown codes, non-primitive params and a missing trace id', () => {
    expect(apiErrorSchema.safeParse({ code: 'nope', traceId: 'abc' }).success).toBe(false);
    expect(
      apiErrorSchema.safeParse({ code: 'internal', params: { a: { b: 1 } }, traceId: 'abc' })
        .success,
    ).toBe(false);
    expect(apiErrorSchema.safeParse({ code: 'internal' }).success).toBe(false);
  });

  it('lists the stable error codes', () => {
    expect(API_ERROR_CODES).toContain('auth.invalidCode');
    expect(API_ERROR_CODES).toContain('validation.failed');
  });
});
