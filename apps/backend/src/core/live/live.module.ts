import { Module } from '@nestjs/common';
import { AttentionModule } from '../attention/index.js';
import { DevicesModule } from '../devices/index.js';
import { GatewaysModule } from '../gateways/index.js';
import { HouseholdsModule } from '../households/index.js';
import { IdentityModule } from '../identity/index.js';
import { LiveController } from './live.controller.js';
import { LiveHub } from './live-hub.js';
import { DEFAULT_LIVE_OPTIONS, LIVE_OPTIONS } from './live.options.js';
import { LivePublisher } from './live-publisher.js';

@Module({
  imports: [DevicesModule, GatewaysModule, AttentionModule, HouseholdsModule, IdentityModule],
  controllers: [LiveController],
  providers: [{ provide: LIVE_OPTIONS, useValue: DEFAULT_LIVE_OPTIONS }, LiveHub, LivePublisher],
})
export class LiveModule {}
