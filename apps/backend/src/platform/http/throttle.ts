import { type ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import {
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';
import { ApiError } from './api-error.js';

const MINUTE_MS = 60_000;

/** Per-IP limits (spec 3.3); `ttl` is in milliseconds. Endpoints opt in with `@RateLimit(name)`. */
export const RATE_LIMITS = {
  emailCodeRequestPerIp: { limit: 10, ttl: 15 * MINUTE_MS },
  emailCodeVerifyPerIp: { limit: 20, ttl: 15 * MINUTE_MS },
  /** Preview, accept and accept-new of an invitation link; each route counts on its own. */
  invitationPerIp: { limit: 20, ttl: 15 * MINUTE_MS },
} as const;
export type RateLimitName = keyof typeof RATE_LIMITS;

const RATE_LIMIT_KEY = 'smart:rate-limits';

/** Applies the named per-IP limits to a handler or controller; everything else is unlimited. */
export const RateLimit = (...names: RateLimitName[]): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, names);

function isEnabled(name: RateLimitName, context: ExecutionContext): boolean {
  const lookup = (target: object): RateLimitName[] =>
    (Reflect.getMetadata(RATE_LIMIT_KEY, target) as RateLimitName[] | undefined) ?? [];
  return lookup(context.getHandler()).includes(name) || lookup(context.getClass()).includes(name);
}

/** In-memory storage (the default); one backend instance serves a household. */
export function createThrottlerOptions(): ThrottlerModuleOptions {
  return {
    throttlers: (Object.keys(RATE_LIMITS) as RateLimitName[]).map((name) => ({
      name,
      ...RATE_LIMITS[name],
      skipIf: (context) => !isEnabled(name, context),
    })),
  };
}

@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'auth.rateLimited', {
      retryAfterSeconds: Math.max(1, Math.ceil(detail.timeToBlockExpire)),
    });
  }
}
