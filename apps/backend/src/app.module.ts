import { Module } from '@nestjs/common';
import { ConfigModule } from './platform/config/index.js';
import { DatabaseModule } from './platform/database/index.js';
import { MqttModule } from './platform/mqtt/index.js';
import { ObservabilityModule } from './platform/observability/index.js';

@Module({
  imports: [ConfigModule, DatabaseModule, MqttModule, ObservabilityModule],
})
export class AppModule {}
