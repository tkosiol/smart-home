import { Module } from '@nestjs/common';
import { GatewaysModule } from '../gateways/index.js';
import { IdentityModule } from '../identity/index.js';
import { TelemetryModule } from '../telemetry/index.js';
import { DeviceHistoryService } from './device-history.service.js';
import { DeviceEvents } from './device-events.js';
import { DevicesController } from './devices.controller.js';
import { DeviceReportProcessor } from './device-report.processor.js';
import { DevicesRepository } from './devices.repository.js';
import { DevicesService } from './devices.service.js';
import { GatewayIngest } from './gateway-ingest.js';
import { HardwareRepository } from './hardware.repository.js';

@Module({
  imports: [GatewaysModule, IdentityModule, TelemetryModule],
  controllers: [DevicesController],
  providers: [
    DeviceEvents,
    HardwareRepository,
    DevicesRepository,
    DevicesService,
    DeviceHistoryService,
    DeviceReportProcessor,
    GatewayIngest,
  ],
  exports: [HardwareRepository, DevicesRepository, DeviceEvents],
})
export class DevicesModule {}
