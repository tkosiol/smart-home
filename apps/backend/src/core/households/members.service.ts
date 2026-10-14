import { HttpStatus, Injectable } from '@nestjs/common';
import { hasRole, type HouseholdRole, type Member } from '@smart/contracts';
import { ApiError } from '../../platform/http/index.js';
import type { Membership } from './households.schema.js';
import { isUuid } from './is-uuid.js';
import { MembershipsRepository } from './memberships.repository.js';

@Injectable()
export class MembersService {
  constructor(private readonly memberships: MembershipsRepository) {}

  async list(householdId: string): Promise<Member[]> {
    const rows = await this.memberships.listMembers(householdId);
    return rows.map(({ joinedAt, ...row }) => ({ ...row, joinedAt: joinedAt.toISOString() }));
  }

  /** Owners change roles and remove anyone; everyone may remove themself (leave). */
  async change(
    caller: Membership,
    targetId: string,
    next: HouseholdRole | 'removed',
  ): Promise<void> {
    // Unknown, malformed and foreign ids answer alike.
    if (!isUuid(targetId)) throw new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');
    const userId = targetId.toLowerCase();
    const leaving = next === 'removed' && userId === caller.userId;
    if (!leaving && !hasRole(caller.role, 'owner')) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'household.forbidden');
    }
    await this.memberships.change(caller.householdId, userId, next);
  }
}
