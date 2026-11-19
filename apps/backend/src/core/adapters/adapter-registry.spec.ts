import type { GatewayAdapter } from './adapter.js';
import { AdapterRegistry } from './adapter-registry.js';

const fake = (kind: string): GatewayAdapter =>
  ({
    kind,
    serviceStatusTopic: 'status',
    parseServiceStatus: () => undefined,
    classify: () => undefined,
    translate: () => [],
    decodeReport: () => ({ values: {}, measuredAt: undefined }),
  }) as unknown as GatewayAdapter;

describe('AdapterRegistry', () => {
  it('finds adapters by kind', () => {
    const z2m = fake('z2m');
    const registry = new AdapterRegistry([z2m]);
    expect(registry.get('z2m')).toBe(z2m);
    expect(registry.get('ha')).toBeUndefined();
    expect(registry.all()).toEqual([z2m]);
  });

  it('refuses two adapters for one kind', () => {
    expect(() => new AdapterRegistry([fake('z2m'), fake('z2m')])).toThrow(
      'Two adapters for gateway kind z2m',
    );
  });
});
