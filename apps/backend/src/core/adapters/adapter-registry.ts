import { Inject, Injectable } from '@nestjs/common';
import type { GatewayAdapter } from './adapter.js';

export const GATEWAY_ADAPTERS = Symbol('GATEWAY_ADAPTERS');

/** The loaded gateway adapters by kind; fixed once the app is built. */
@Injectable()
export class AdapterRegistry {
  private readonly byKind = new Map<string, GatewayAdapter>();

  constructor(@Inject(GATEWAY_ADAPTERS) adapters: readonly GatewayAdapter[]) {
    for (const adapter of adapters) {
      if (this.byKind.has(adapter.kind))
        throw new Error(`Two adapters for gateway kind ${adapter.kind}`);
      this.byKind.set(adapter.kind, adapter);
    }
  }

  get(kind: string): GatewayAdapter | undefined {
    return this.byKind.get(kind);
  }

  all(): readonly GatewayAdapter[] {
    return [...this.byKind.values()];
  }
}
