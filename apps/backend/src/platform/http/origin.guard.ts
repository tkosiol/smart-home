import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ENV, type Env } from '../config/index.js';
import { ApiError } from './api-error.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { SKIP_ORIGIN_CHECK_KEY } from './skip-origin-check.decorator.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly reflector: Reflector,
  ) {}

  /**
   * CSRF defence (spec 3.10): SameSite=Lax cookies plus an exact Origin match on mutating requests,
   * except on public handlers marked `@SkipOriginCheck()`.
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!MUTATING.has(request.method)) return true;
    if (this.skips(context)) return true;
    if (request.headers.origin === this.env.APP_ORIGIN) return true;
    throw new ApiError(HttpStatus.FORBIDDEN, 'auth.badOrigin');
  }

  /**
   * A handler marked `@SkipOriginCheck()` that is also `@Public()`: the session guard reads no
   * session there, so a forged cross-site request carries nothing to abuse. On a route behind a
   * session the marker counts for nothing.
   */
  private skips(context: ExecutionContext): boolean {
    const marked = this.reflector.get<boolean | undefined>(
      SKIP_ORIGIN_CHECK_KEY,
      context.getHandler(),
    );
    if (marked !== true) return false;
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return isPublic === true;
  }
}
