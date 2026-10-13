import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasRole, type HouseholdRole } from '@smart/contracts';
import type { AuthenticatedRequest } from '../identity/index.js';
import { ApiError } from '../../platform/http/index.js';
import type { Membership } from './households.schema.js';
import { isUuid } from './is-uuid.js';
import { MembershipsRepository } from './memberships.repository.js';
import { REQUIRED_ROLE } from './require-role.decorator.js';

/** A request after `HouseholdGuard`: the caller's membership in `:householdId`. */
export type HouseholdRequest = AuthenticatedRequest & { membership?: Membership };

/** The membership `HouseholdGuard` attached; a missing one means the route lacks the guard. */
export const membershipOf = (request: HouseholdRequest): Membership => {
  if (!request.membership) throw new Error('household guard did not attach the membership');
  return request.membership;
};

/**
 * Tenant guard for routes under `v1/households/:householdId`: the caller must be a member with at
 * least the role declared by `@RequireRole`. Runs after the global session check.
 */
@Injectable()
export class HouseholdGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly memberships: MembershipsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<HouseholdRole | undefined>(REQUIRED_ROLE, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Fail closed: a household route without a declared role is a programming error.
    if (!required) throw new Error('household route without @RequireRole');
    const request = context.switchToHttp().getRequest<HouseholdRequest>();
    if (!request.user) throw new ApiError(HttpStatus.UNAUTHORIZED, 'auth.required');
    const param: unknown = request.params['householdId'];
    const householdId = typeof param === 'string' ? param : '';
    // Unknown, malformed and foreign households answer alike: no hint that a household exists.
    const membership = isUuid(householdId)
      ? await this.memberships.find(householdId, request.user.id)
      : undefined;
    if (!membership) throw new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');
    if (!hasRole(membership.role, required)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'household.forbidden');
    }
    request.membership = membership;
    return true;
  }
}
