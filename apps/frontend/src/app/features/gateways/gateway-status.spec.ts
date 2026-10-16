import type { GatewayStatus } from '@smart/contracts';
import { statusKey } from './gateway-status';

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
