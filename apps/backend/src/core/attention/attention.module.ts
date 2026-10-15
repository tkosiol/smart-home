import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/index.js';
import { GatewaysModule } from '../gateways/index.js';
import { IdentityModule } from '../identity/index.js';
import { AttentionController } from './attention.controller.js';
import { AttentionService } from './attention.service.js';

@Module({
  imports: [DevicesModule, GatewaysModule, IdentityModule],
  controllers: [AttentionController],
  providers: [AttentionService],
  exports: [AttentionService],
})
export class AttentionModule {}
