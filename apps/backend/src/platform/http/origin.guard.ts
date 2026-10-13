import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { ENV, type Env } from '../config/index.js';
import { ApiError } from './api-error.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  /** CSRF defence (spec 3.10): SameSite=Lax cookies plus an exact Origin match on mutating requests. */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!MUTATING.has(request.method)) return true;
    if (request.headers.origin === this.env.APP_ORIGIN) return true;
    throw new ApiError(HttpStatus.FORBIDDEN, 'auth.badOrigin');
  }
}
