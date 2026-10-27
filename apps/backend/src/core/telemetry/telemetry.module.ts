import { Module } from '@nestjs/common';
import { HistoryRepository } from './history.repository.js';
import { MeasurementWriter } from './measurement-writer.js';
import { MeasurementsRepository } from './measurements.repository.js';

@Module({
  providers: [MeasurementsRepository, MeasurementWriter, HistoryRepository],
  exports: [MeasurementsRepository, MeasurementWriter, HistoryRepository],
})
export class TelemetryModule {}
