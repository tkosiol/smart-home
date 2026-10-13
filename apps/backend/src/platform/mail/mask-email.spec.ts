import { describe, expect, it } from 'vitest';
import { maskEmail } from './mask-email.js';

describe('maskEmail', () => {
  it('keeps the first character and the domain', () => {
    expect(maskEmail('till@example.org')).toBe('t***@example.org');
  });

  it('masks a one-character local part the same way', () => {
    expect(maskEmail('a@example.org')).toBe('a***@example.org');
  });

  it('hides everything when the value is not an address', () => {
    expect(maskEmail('not-an-address')).toBe('***');
    expect(maskEmail('@example.org')).toBe('***@example.org');
  });
});
