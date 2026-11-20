import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/index.js';
import { GatewayCredentials } from './credentials/gateway-credentials.service.js';
import { GatewayEvents } from './gateway-events.js';
import { GatewayExpiryJob } from './gateway-expiry.job.js';
import { GATEWAY_STATUS_MEMORY, StatusMemory } from './gateway-status-memory.js';
import { GatewayStatusConsumer } from './gateway-status.consumer.js';
import { GatewaysController } from './gateways.controller.js';
import { GatewaysRepository } from './gateways.repository.js';
import { GatewaysService } from './gateways.service.js';
import { GatewayPairingsRepository } from './pairing/gateway-pairings.repository.js';
import { PairingCleanupJob } from './pairing/pairing-cleanup.job.js';
import {
  GatewayPairingRedeemController,
  GatewayPairingsController,
} from './pairing/pairing.controller.js';
import { PairingService } from './pairing/pairing.service.js';

@Module({
  imports: [IdentityModule],
  controllers: [GatewaysController, GatewayPairingsController, GatewayPairingRedeemController],
  providers: [
    GatewaysRepository,
    GatewaysService,
    GatewayEvents,
    { provide: StatusMemory, useFactory: () => new StatusMemory() },
    // What the status consumer heard from gateways that are not registered yet.
    { provide: GATEWAY_STATUS_MEMORY, useExisting: StatusMemory },
    GatewayStatusConsumer,
    GatewayExpiryJob,
    GatewayCredentials,
    GatewayPairingsRepository,
    PairingService,
    PairingCleanupJob,
  ],
  exports: [GatewayEvents, GatewaysService],
})
export class GatewaysModule {}
