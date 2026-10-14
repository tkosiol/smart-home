import { Module } from '@nestjs/common';
import { GatewaysModule } from '../gateways/index.js';
import { IdentityModule } from '../identity/index.js';
import { DeviceIngestConsumer } from './device-ingest.consumer.js';
import { DEVICE_MESSAGE_HANDLER } from './device-message-handler.js';
import { DevicesRepository } from './devices.repository.js';
import { HardwareRepository } from './hardware.repository.js';
import { LastStateHandler } from './last-state.handler.js';

@Module({
  imports: [GatewaysModule, IdentityModule],
  providers: [
    HardwareRepository,
    DevicesRepository,
    // Replaced by the processing of readings.
    { provide: DEVICE_MESSAGE_HANDLER, useClass: LastStateHandler },
    DeviceIngestConsumer,
  ],
  exports: [HardwareRepository, DevicesRepository],
})
export class DevicesModule {}
