import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/index.js';
import { GATEWAY_STATUS_MEMORY, noStatusMemory } from './gateway-status-memory.js';
import { GatewaysController } from './gateways.controller.js';
import { GatewaysRepository } from './gateways.repository.js';
import { GatewaysService } from './gateways.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [GatewaysController],
  providers: [
    GatewaysRepository,
    GatewaysService,
    // Replaced by the MQTT status consumer, which remembers what unregistered gateways reported.
    { provide: GATEWAY_STATUS_MEMORY, useValue: noStatusMemory },
  ],
})
export class GatewaysModule {}
