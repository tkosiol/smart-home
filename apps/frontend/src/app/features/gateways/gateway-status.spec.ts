import type { GatewayStatus } from '@smart/contracts';
import { kindKey, statusKey } from './gateway-status';

describe('statusKey', () => {
  it.each([
    ['online', 'gateways.status.online'],
    ['offline', 'gateways.status.offline'],
    ['unknown', 'gateways.status.unknown'],
  ] as const satisfies readonly (readonly [GatewayStatus, string])[])(
    'maps %s to its translation key',
    (status, key) => {
      expect(statusKey(status)).toBe(key);
    },
  );
});

describe('kindKey', () => {
  it('is the translation key of the gateway kind', () => {
    expect(kindKey('z2m')).toBe('gateways.kind.z2m');
  });
});
