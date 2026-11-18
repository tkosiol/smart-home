import { type DynamicModule, Module, type Type } from '@nestjs/common';
import type { GatewayAdapter } from './adapter.js';
import { AdapterRegistry, GATEWAY_ADAPTERS } from './adapter-registry.js';

/** Loads the gateway adapters; `app.module.ts` lists them once. Global, so core modules just inject the registry. */
@Module({})
export class AdaptersModule {
  static forRoot(modules: Type[], adapters: Type<GatewayAdapter>[]): DynamicModule {
    return {
      module: AdaptersModule,
      global: true,
      imports: modules,
      providers: [
        {
          provide: GATEWAY_ADAPTERS,
          useFactory: (...list: GatewayAdapter[]) => list,
          inject: adapters,
        },
        AdapterRegistry,
      ],
      exports: [GATEWAY_ADAPTERS, AdapterRegistry],
    };
  }
}
