import { utcInstantSchema } from '@smart/contracts';

describe('@smart/contracts wiring', () => {
  it('is resolvable from the frontend test build', () => {
    expect(utcInstantSchema.safeParse('2026-10-25T01:30:00Z').success).toBe(true);
    expect(utcInstantSchema.safeParse('2026-10-25T03:30:00+02:00').success).toBe(false);
  });
});
