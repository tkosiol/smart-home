import { Module } from '@nestjs/common';
import { DevicesRepository } from './devices.repository.js';
import { HardwareRepository } from './hardware.repository.js';

@Module({
  providers: [HardwareRepository, DevicesRepository],
  exports: [HardwareRepository, DevicesRepository],
})
export class DevicesModule {}
