import { Module } from '@nestjs/common';
import { ConfigModule } from './platform/config/index.js';
import { DatabaseModule } from './platform/database/index.js';
import { HttpModule } from './platform/http/index.js';
import { MailModule } from './platform/mail/index.js';
import { MqttModule } from './platform/mqtt/index.js';
import { ObservabilityModule } from './platform/observability/index.js';

@Module({
  imports: [ConfigModule, DatabaseModule, HttpModule, MailModule, MqttModule, ObservabilityModule],
})
export class AppModule {}
