import { Module } from '@nestjs/common';
import { GatewaysModule } from '../gateways/index.js';
import { IdentityModule } from '../identity/index.js';
import { TelemetryModule } from '../telemetry/index.js';
import { DeviceEvents } from './device-events.js';
import { DevicesController } from './devices.controller.js';
import { DeviceIngestConsumer } from './device-ingest.consumer.js';
import { DEVICE_MESSAGE_HANDLER } from './device-message-handler.js';
import { DeviceMessageProcessor } from './device-message.handler.js';
import { DevicesRepository } from './devices.repository.js';
import { DevicesService } from './devices.service.js';
import { HardwareRepository } from './hardware.repository.js';

@Module({
  imports: [GatewaysModule, IdentityModule, TelemetryModule],
  controllers: [DevicesController],
  providers: [
    DeviceEvents,
    HardwareRepository,
    DevicesRepository,
    DevicesService,
    { provide: DEVICE_MESSAGE_HANDLER, useClass: DeviceMessageProcessor },
    DeviceIngestConsumer,
  ],
  exports: [HardwareRepository, DevicesRepository, DeviceEvents],
})
export class DevicesModule {}
