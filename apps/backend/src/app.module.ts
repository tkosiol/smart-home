import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { GatewaysModule } from './core/gateways/index.js';
import { HouseholdsModule } from './core/households/index.js';
import { IdentityModule } from './core/identity/index.js';
import { ConfigModule } from './platform/config/index.js';
import { DatabaseModule } from './platform/database/index.js';
import { HttpModule } from './platform/http/index.js';
import { MailModule } from './platform/mail/index.js';
import { MqttModule } from './platform/mqtt/index.js';
import { ObservabilityModule } from './platform/observability/index.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule,
    DatabaseModule,
    // HttpModule before IdentityModule: global guards run in registration order (Origin, rate
    // limits, then the session check).
    HttpModule,
    IdentityModule,
    HouseholdsModule,
    GatewaysModule,
    MailModule,
    MqttModule,
    ObservabilityModule,
  ],
})
export class AppModule {}
