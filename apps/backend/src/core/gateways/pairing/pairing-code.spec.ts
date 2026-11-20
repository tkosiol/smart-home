import { GATEWAY_ID_PATTERN, PAIRING_CODE_PATTERN } from '@smart/contracts';
import { describe, expect, it } from 'vitest';
import {
  hashPairingCode,
  newGatewayId,
  newPairingCode,
  normalizePairingCode,
  PAIRING_ALPHABET,
} from './pairing-code.js';

describe('pairing codes', () => {
  it('shows 8 characters of the alphabet as XXXX-XXXX', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const code = newPairingCode();
      expect(code).toMatch(PAIRING_CODE_PATTERN);
      for (const char of code.replace('-', '')) expect(PAIRING_ALPHABET).toContain(char);
      seen.add(code);
    }
    // 40 bits of randomness: 1000 draws never repeat in practice.
    expect(seen.size).toBe(1000);
  });

  it('normalizes every spelling of a code to its 8 characters', () => {
    for (const input of ['k7qm-4xwp', ' K7QM 4XWP ', 'K7QM4XWP', 'K7QM-4XWP']) {
      expect(normalizePairingCode(input)).toBe('K7QM4XWP');
    }
    expect(normalizePairingCode('O0IL-1234')).toBe('00111234');
    expect(normalizePairingCode('oil0-1234')).toBe('01101234');
  });

  it('rejects what is not 8 characters of the alphabet', () => {
    expect(normalizePairingCode('K7QM-4XW')).toBeUndefined();
    expect(normalizePairingCode('K7QM-4XWPP')).toBeUndefined();
    expect(normalizePairingCode('K7QM-4XWU')).toBeUndefined();
    expect(normalizePairingCode('K7QM_4XWP')).toBeUndefined();
    expect(normalizePairingCode('')).toBeUndefined();
  });

  it('accepts a shown code as it is', () => {
    const code = newPairingCode();
    expect(normalizePairingCode(code)).toBe(code.replace('-', ''));
  });

  it('hashes the normalized code with SHA-256', () => {
    expect(hashPairingCode('K7QM4XWP')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPairingCode('K7QM4XWP')).toBe(hashPairingCode('K7QM4XWP'));
    expect(hashPairingCode('K7QM4XWP')).not.toBe(hashPairingCode('K7QM4XWQ'));
  });

  it('draws gateway IDs that fit the pattern', () => {
    for (let i = 0; i < 100; i++) expect(newGatewayId()).toMatch(GATEWAY_ID_PATTERN);
  });
});
