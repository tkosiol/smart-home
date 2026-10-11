import { Module } from '@nestjs/common';
import { ObservabilityModule } from './platform/observability/index.js';

@Module({
  imports: [ObservabilityModule],
})
export class AppModule {}
