import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../../platform/http/index.js';
import type { AuthenticatedRequest } from './authenticated-user.js';
import { UsersRepository } from './users.repository.js';

/**
 * Lets only platform admins through. Runs after the global session check; the flag is read from
 * the database on every request, so a revoked admin loses access at once.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly users: UsersRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) throw new ApiError(HttpStatus.UNAUTHORIZED, 'auth.required');
    const user = await this.users.findById(request.user.id);
    if (!user) throw new ApiError(HttpStatus.UNAUTHORIZED, 'auth.required');
    if (!user.isPlatformAdmin) throw new ApiError(HttpStatus.FORBIDDEN, 'auth.forbidden');
    return true;
  }
}
