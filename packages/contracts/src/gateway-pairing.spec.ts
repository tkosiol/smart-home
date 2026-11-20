import { describe, expect, it } from 'vitest';
import {
  PAIRING_CODE_PATTERN,
  gatewayPairingCreateSchema,
  gatewayPairingRedeemSchema,
  gatewayPairingRedeemedSchema,
  gatewayPairingSchema,
} from './gateway-pairing.js';

describe('PAIRING_CODE_PATTERN', () => {
  it('matches two groups of four Crockford base32 characters', () => {
    expect(PAIRING_CODE_PATTERN.test('K7QM-4XWP')).toBe(true);
  });

  it.each(['K7QM4XWP', 'I7QM-4XWP', 'K7QM-4XWO', 'k7qm-4xwp', 'K7QM-4XW', 'K7QM-4XWPP'])(
    'rejects %j',
    (value) => {
      expect(PAIRING_CODE_PATTERN.test(value)).toBe(false);
    },
  );
});

describe('gatewayPairingCreateSchema', () => {
  it('takes an optional gateway ID', () => {
    expect(gatewayPairingCreateSchema.safeParse({}).success).toBe(true);
    expect(gatewayPairingCreateSchema.safeParse({ gatewayId: 'gw-a1b2c3d4' }).success).toBe(true);
    expect(gatewayPairingCreateSchema.safeParse({ gatewayId: 'api' }).success).toBe(false);
  });
});

describe('gatewayPairingSchema', () => {
  it('describes the code with its expiry and the app address', () => {
    const value = {
      code: 'K7QM-4XWP',
      expiresAt: '2026-11-20T10:15:00.000Z',
      appUrl: 'https://smart.example.org',
    };
    expect(gatewayPairingSchema.safeParse(value).success).toBe(true);
    expect(gatewayPairingSchema.safeParse({ ...value, appUrl: undefined }).success).toBe(false);
  });
});

describe('gatewayPairingRedeemSchema', () => {
  it('accepts a code with an optional name and expected gateway', () => {
    const parsed = gatewayPairingRedeemSchema.safeParse({
      code: 'K7QM-4XWP',
      name: '  Home Assistant  ',
      expectedGatewayId: 'gw-a1b2c3d4',
    });
    expect(parsed.success && parsed.data.name).toBe('Home Assistant');
    expect(gatewayPairingRedeemSchema.safeParse({ code: 'k7qm 4xwp' }).success).toBe(true);
  });

  it('rejects an empty code, one above 32 characters and a bad expected gateway', () => {
    expect(gatewayPairingRedeemSchema.safeParse({ code: '' }).success).toBe(false);
    expect(gatewayPairingRedeemSchema.safeParse({ code: 'A'.repeat(33) }).success).toBe(false);
    expect(gatewayPairingRedeemSchema.safeParse({ code: 'A'.repeat(32) }).success).toBe(true);
    expect(
      gatewayPairingRedeemSchema.safeParse({ code: 'A', expectedGatewayId: 'x' }).success,
    ).toBe(false);
  });
});

describe('gatewayPairingRedeemedSchema', () => {
  it('carries the broker address and the credentials', () => {
    const value = {
      gatewayId: 'gw-a1b2c3d4',
      mqttUrl: 'wss://smart.example.org/mqtt',
      username: 'gw-a1b2c3d4',
      password: 'secret',
      clientId: 'gw-a1b2c3d4-ha',
    };
    expect(gatewayPairingRedeemedSchema.safeParse(value).success).toBe(true);
    expect(gatewayPairingRedeemedSchema.safeParse({ ...value, password: undefined }).success).toBe(
      false,
    );
  });
});
