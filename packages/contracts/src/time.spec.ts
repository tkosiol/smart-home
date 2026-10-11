import { describe, expect, it } from 'vitest';
import { localDateSchema, utcInstantSchema } from './time.js';

describe('utcInstantSchema', () => {
  it.each(['2026-10-25T01:30:00Z', '2026-10-25T01:30:00.123Z', '2026-03-29T00:59:59Z'])(
    'accepts the UTC instant %s',
    (value) => {
      expect(utcInstantSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each(['2026-10-25T03:30:00+02:00', '2026-10-25T01:30:00', '2026-10-25', 'not-a-date', ''])(
    'rejects %j because only UTC instants with "Z" are allowed',
    (value) => {
      expect(utcInstantSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('localDateSchema', () => {
  it.each(['2026-10-25', '2028-02-29'])('accepts the calendar date %s', (value) => {
    expect(localDateSchema.safeParse(value).success).toBe(true);
  });

  it.each(['2026-02-29', '2026-13-01', '2026-04-31', '2026-10-25T00:00:00Z', '25.10.2026'])(
    'rejects %j',
    (value) => {
      expect(localDateSchema.safeParse(value).success).toBe(false);
    },
  );
});
