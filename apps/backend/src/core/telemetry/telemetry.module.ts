import { Module } from '@nestjs/common';
import { MeasurementWriter } from './measurement-writer.js';
import { MeasurementsRepository } from './measurements.repository.js';

@Module({
  providers: [MeasurementsRepository, MeasurementWriter],
  exports: [MeasurementsRepository, MeasurementWriter],
})
export class TelemetryModule {}
