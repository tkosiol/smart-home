import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ApiErrorFilter } from './api-error.filter.js';
import { OriginGuard } from './origin.guard.js';
import { createThrottlerOptions, RateLimitGuard } from './throttle.js';

@Module({
  imports: [ThrottlerModule.forRoot(createThrottlerOptions())],
  providers: [
    { provide: APP_FILTER, useClass: ApiErrorFilter },
    // Guards run in this order: the Origin check first, then the rate limits.
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class HttpModule {}
