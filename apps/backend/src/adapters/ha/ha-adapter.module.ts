import { Module } from '@nestjs/common';
import { HaAdapter } from './ha.adapter.js';

/** Provides the Home Assistant adapter for `AdaptersModule.forRoot`. */
@Module({ providers: [HaAdapter], exports: [HaAdapter] })
export class HaAdapterModule {}
