import { describe, expect, it } from 'vitest';
import { healthLiveResponseSchema } from './health.js';

describe('healthLiveResponseSchema', () => {
  it('accepts { status: "ok" }', () => {
    expect(healthLiveResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
  });

  it.each([{ status: 'down' }, {}, null])('rejects %j', (value) => {
    expect(healthLiveResponseSchema.safeParse(value).success).toBe(false);
  });
});
