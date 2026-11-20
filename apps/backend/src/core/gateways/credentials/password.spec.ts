import { describe, expect, it } from 'vitest';
import { deriveGatewayPassword, gatewayClientId, generationTag } from './password.js';

const SECRET = 'x'.repeat(32);

describe('deriveGatewayPassword', () => {
  it('matches the fixed test vector', () => {
    // Computed once with node:crypto createHmac (spec 5.3).
    expect(deriveGatewayPassword(SECRET, 'gw-abcdefgh', 1)).toBe(
      'CK1GBb9oDj7Oh2ftXNT3HqKI3RGxZ-JiCd66B8it_jQ',
    );
  });

  it('gives another key for another generation', () => {
    expect(deriveGatewayPassword(SECRET, 'gw-abcdefgh', 2)).not.toBe(
      deriveGatewayPassword(SECRET, 'gw-abcdefgh', 1),
    );
  });

  it('gives 43 URL-safe characters', () => {
    const password = deriveGatewayPassword(SECRET, 'gw-12345678', 7);
    expect(password).toHaveLength(43);
    expect(password).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('gatewayClientId and generationTag', () => {
  it('bind the client ID to the gateway and name the generation', () => {
    expect(gatewayClientId('gw-abcdefgh')).toBe('gw-abcdefgh-ha');
    expect(generationTag(3)).toBe('generation:3');
  });
});
