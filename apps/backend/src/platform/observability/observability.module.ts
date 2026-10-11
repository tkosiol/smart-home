import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { LoggingModule } from './logging.module.js';
import { ReadinessService } from './readiness.service.js';

@Module({
  imports: [LoggingModule],
  controllers: [HealthController],
  providers: [ReadinessService],
})
export class ObservabilityModule {}
