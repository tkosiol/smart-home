import { Module } from '@nestjs/common';
import { Z2mAdapter } from './z2m.adapter.js';

/** Provides the Zigbee2MQTT adapter for `AdaptersModule.forRoot`. */
@Module({ providers: [Z2mAdapter], exports: [Z2mAdapter] })
export class Z2mAdapterModule {}
