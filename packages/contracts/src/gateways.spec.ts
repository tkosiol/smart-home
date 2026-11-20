import { describe, expect, it } from 'vitest';
import {
  GATEWAY_AUTHS,
  GATEWAY_ID_PATTERN,
  GATEWAY_STATUSES,
  GATEWAY_WARNINGS,
  gatewayIdSchema,
  gatewayRegisterSchema,
  gatewaySchema,
} from './gateways.js';
import { API_ERROR_CODES } from './api-error.js';

describe('gatewayIdSchema', () => {
  it('accepts gw- plus eight lowercase letters or digits', () => {
    expect(gatewayIdSchema.safeParse('gw-a1b2c3d4').success).toBe(true);
    expect(GATEWAY_ID_PATTERN.test('gw-00000000')).toBe(true);
  });

  it.each(['gw-A1B2C3D4', 'gw-a1b2c3d', 'gw-a1b2c3d45', 'smart-api', 'api', ''])(
    'rejects %j',
    (value) => {
      expect(gatewayIdSchema.safeParse(value).success).toBe(false);
    },
  );

  it('rejects a prefix and a trailing newline', () => {
    const valid = 'gw-a1b2c3d4';
    expect(gatewayIdSchema.safeParse(`x${valid}`).success).toBe(false);
    expect(gatewayIdSchema.safeParse(`${valid}\n`).success).toBe(false);
  });
});

describe('gateway statuses and warnings', () => {
  it('lists them', () => {
    expect(GATEWAY_STATUSES).toEqual(['online', 'offline', 'unknown']);
    expect(GATEWAY_WARNINGS).toEqual(['certExpiring', 'certExpired', 'crlExpiring']);
  });
});

describe('gatewaySchema', () => {
  const gateway = {
    id: 'gw-a1b2c3d4',
    name: 'Keller',
    kind: 'z2m' as const,
    topicPrefix: 'zigbee2mqtt',
    bridgeStatus: 'online' as const,
    serviceStatus: 'unknown' as const,
    statusChangedAt: '2026-10-14T08:00:00.000Z',
    lastMessageAt: null,
    auth: 'certificate' as const,
    certExpiresAt: '2027-10-14T08:00:00.000Z',
    credentialGeneration: null,
    revokedAt: null,
    warnings: [],
  };

  it('accepts a gateway without warnings', () => {
    expect(gatewaySchema.safeParse(gateway).success).toBe(true);
  });

  it('accepts a gateway with warnings and a revocation', () => {
    const parsed = gatewaySchema.safeParse({
      ...gateway,
      warnings: ['certExpiring', 'crlExpiring'],
      revokedAt: '2026-10-15T08:00:00.000Z',
      statusChangedAt: null,
      lastMessageAt: '2026-10-14T08:05:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown kind, status or warning and a bad id', () => {
    expect(gatewaySchema.safeParse({ ...gateway, kind: 'zwave' }).success).toBe(false);
    expect(gatewaySchema.safeParse({ ...gateway, bridgeStatus: 'broken' }).success).toBe(false);
    expect(gatewaySchema.safeParse({ ...gateway, warnings: ['nope'] }).success).toBe(false);
    expect(gatewaySchema.safeParse({ ...gateway, id: 'api' }).success).toBe(false);
  });

  it('accepts the kind ha', () => {
    expect(gatewaySchema.safeParse({ ...gateway, kind: 'ha' }).success).toBe(true);
  });

  it('requires the certificate expiry to be present, but it may be null', () => {
    expect(gatewaySchema.safeParse({ ...gateway, certExpiresAt: undefined }).success).toBe(false);
    expect(gatewaySchema.safeParse({ ...gateway, certExpiresAt: null }).success).toBe(true);
  });

  it('requires the credential generation to be present, but it may be null', () => {
    expect(gatewaySchema.safeParse({ ...gateway, credentialGeneration: undefined }).success).toBe(
      false,
    );
    expect(gatewaySchema.safeParse({ ...gateway, credentialGeneration: 2 }).success).toBe(true);
    expect(gatewaySchema.safeParse({ ...gateway, credentialGeneration: '2' }).success).toBe(false);
  });

  it('accepts credentials access without a certificate expiry and rejects an unknown access', () => {
    expect(
      gatewaySchema.safeParse({ ...gateway, kind: 'ha', auth: 'credentials', certExpiresAt: null })
        .success,
    ).toBe(true);
    expect(gatewaySchema.safeParse({ ...gateway, auth: 'token' }).success).toBe(false);
    expect(gatewaySchema.safeParse({ ...gateway, auth: undefined }).success).toBe(false);
    expect(GATEWAY_AUTHS).toEqual(['certificate', 'credentials']);
  });
});

describe('gatewayRegisterSchema', () => {
  it('accepts a name and a certificate', () => {
    const parsed = gatewayRegisterSchema.safeParse({
      name: '  Keller  ',
      certificate: 'not-a-real-certificate',
    });
    expect(parsed.success && parsed.data.name).toBe('Keller');
  });

  it('accepts the kind but does not require it', () => {
    const base = { name: 'Keller', certificate: 'abc' };
    expect(gatewayRegisterSchema.safeParse(base).success).toBe(true);
    expect(gatewayRegisterSchema.safeParse({ ...base, kind: 'z2m' }).success).toBe(true);
    expect(gatewayRegisterSchema.safeParse({ ...base, kind: 'ha' }).success).toBe(true);
    expect(gatewayRegisterSchema.safeParse({ ...base, kind: 'hue' }).success).toBe(false);
  });

  it('rejects an empty certificate and one above 20 000 characters', () => {
    expect(gatewayRegisterSchema.safeParse({ name: 'Keller', certificate: '' }).success).toBe(
      false,
    );
    expect(
      gatewayRegisterSchema.safeParse({ name: 'Keller', certificate: 'a'.repeat(20_000) }).success,
    ).toBe(true);
    expect(
      gatewayRegisterSchema.safeParse({ name: 'Keller', certificate: 'a'.repeat(20_001) }).success,
    ).toBe(false);
  });

  it('rejects an empty name', () => {
    expect(gatewayRegisterSchema.safeParse({ name: ' ', certificate: 'abc' }).success).toBe(false);
  });
});

describe('gateway error codes', () => {
  it.each([
    'gateway.invalidCertificate',
    'gateway.exists',
    'gateway.caMissing',
    'gateway.pairingInvalid',
    'gateway.pairingOtherGateway',
    'gateway.limitReached',
    'gateway.pairingUnavailable',
  ])('lists %s', (code) => {
    expect(API_ERROR_CODES).toContain(code);
  });
});
