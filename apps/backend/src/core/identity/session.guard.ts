import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { ApiError, IS_PUBLIC_KEY } from '../../platform/http/index.js';
import type { AuthenticatedRequest } from './authenticated-user.js';
import { CLOCK, type Clock } from './clock.js';
import { SESSION_COOKIE, setSessionCookie } from './session.cookie.js';
import { SessionService } from './session.service.js';

/** Global guard: every route needs a valid session unless it is marked `@Public()`. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const token: unknown = (request.cookies as Record<string, unknown> | undefined)?.[
      SESSION_COOKIE
    ];
    const session = typeof token === 'string' ? await this.sessions.validate(token) : null;
    if (typeof token !== 'string' || !session) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'auth.required');
    }

    request.user = { id: session.userId, sessionId: session.sessionId };
    if (session.refreshed) {
      setSessionCookie(http.getResponse<Response>(), token, session.expiresAt, this.clock());
    }
    return true;
  }
}
