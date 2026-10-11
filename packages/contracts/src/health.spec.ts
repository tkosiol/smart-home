import { describe, expect, it } from 'vitest';
import { healthLiveResponseSchema, healthReadyResponseSchema } from './health.js';

describe('healthLiveResponseSchema', () => {
  it('accepts { status: "ok" }', () => {
    expect(healthLiveResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
  });

  it.each([{ status: 'down' }, {}, null])('rejects %j', (value) => {
    expect(healthLiveResponseSchema.safeParse(value).success).toBe(false);
  });
});

describe('healthReadyResponseSchema', () => {
  it('accepts a ready service', () => {
    const value = { status: 'ok', checks: { database: 'up', broker: 'up' } };
    expect(healthReadyResponseSchema.parse(value)).toEqual(value);
  });

  it('accepts an unavailable service', () => {
    const value = { status: 'unavailable', checks: { database: 'down', broker: 'up' } };
    expect(healthReadyResponseSchema.parse(value)).toEqual(value);
  });

  it.each([
    { status: 'ok' },
    { status: 'ok', checks: { database: 'up' } },
    { status: 'fine', checks: { database: 'up', broker: 'up' } },
    { status: 'ok', checks: { database: 'maybe', broker: 'up' } },
  ])('rejects %j', (value) => {
    expect(healthReadyResponseSchema.safeParse(value).success).toBe(false);
  });
});
