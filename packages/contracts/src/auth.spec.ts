import { describe, expect, it } from 'vitest';
import { DEFAULT_PERSONAL_APPEARANCE } from './appearance.js';
import {
  emailCodeRequestSchema,
  emailCodeVerifySchema,
  meSchema,
  normalizeEmail,
  preferencesUpdateSchema,
} from './auth.js';

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail(' Till@Example.ORG ')).toBe('till@example.org');
  });
});

describe('emailCodeRequestSchema', () => {
  it('accepts a valid e-mail and normalizes it', () => {
    const parsed = emailCodeRequestSchema.safeParse({ email: ' Till@Example.ORG ' });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ email: 'till@example.org' });
  });

  it.each(['', 'till', 'till@', '@example.org', 'till@example', 'a b@example.org'])(
    'rejects the invalid e-mail %j',
    (email) => {
      expect(emailCodeRequestSchema.safeParse({ email }).success).toBe(false);
    },
  );
});

describe('emailCodeVerifySchema', () => {
  const email = 'till@example.org';

  it('accepts a six-digit code', () => {
    expect(emailCodeVerifySchema.safeParse({ email, code: '012345' }).success).toBe(true);
  });

  it.each(['12345', '1234567', '12345a', 'abcdef', '', '123 56'])('rejects the code %j', (code) => {
    expect(emailCodeVerifySchema.safeParse({ email, code }).success).toBe(false);
  });

  it('normalizes the e-mail', () => {
    const parsed = emailCodeVerifySchema.safeParse({ email: ' TILL@example.org', code: '123456' });
    expect(parsed.data?.email).toBe(email);
  });
});

describe('meSchema', () => {
  const me = {
    id: 'u1',
    email: 'till@example.org',
    displayName: 'Till',
    locale: 'de',
    appearance: DEFAULT_PERSONAL_APPEARANCE,
    isPlatformAdmin: false,
  };

  it('accepts a complete profile', () => {
    expect(meSchema.safeParse(me).success).toBe(true);
  });

  it('rejects an unknown locale', () => {
    expect(meSchema.safeParse({ ...me, locale: 'fr' }).success).toBe(false);
  });
});

describe('preferencesUpdateSchema', () => {
  it('accepts partial updates', () => {
    expect(preferencesUpdateSchema.safeParse({}).success).toBe(true);
    expect(preferencesUpdateSchema.safeParse({ locale: 'en' }).success).toBe(true);
    expect(preferencesUpdateSchema.safeParse({ locale: 'fr' }).success).toBe(false);
  });
});
