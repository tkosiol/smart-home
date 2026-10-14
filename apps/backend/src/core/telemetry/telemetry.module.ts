import { Module } from '@nestjs/common';
import { MeasurementsRepository } from './measurements.repository.js';

@Module({
  providers: [MeasurementsRepository],
  exports: [MeasurementsRepository],
})
export class TelemetryModule {}
