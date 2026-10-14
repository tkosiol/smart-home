import { createParamDecorator, type ExecutionContext, HttpStatus } from '@nestjs/common';
import { ApiError } from '../../platform/http/index.js';
import type { AuthenticatedRequest, AuthenticatedUser } from './authenticated-user.js';

/** The signed-in user of the request; only available on routes that are not `@Public()`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) throw new ApiError(HttpStatus.UNAUTHORIZED, 'auth.required');
    return user;
  },
);
