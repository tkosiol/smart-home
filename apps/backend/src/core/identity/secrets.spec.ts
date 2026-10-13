import { newLoginCode, newToken, sameHash, sha256 } from './secrets.js';

describe('secrets', () => {
  it('creates 32 random bytes as base64url', () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
  });

  it('hashes with SHA-256 as lowercase hex', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('creates six-digit codes including leading zeros', () => {
    for (let i = 0; i < 200; i++) expect(newLoginCode()).toMatch(/^\d{6}$/);
  });

  it('compares hashes in constant time, also for different lengths', () => {
    expect(sameHash(sha256('a'), sha256('a'))).toBe(true);
    expect(sameHash(sha256('a'), sha256('b'))).toBe(false);
    expect(sameHash(sha256('a'), 'short')).toBe(false);
  });
});
