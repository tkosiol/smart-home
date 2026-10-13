import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { HouseholdRole } from '@smart/contracts';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type DatabaseConnection } from '../../platform/database/index.js';
import { ApiError } from '../../platform/http/index.js';
import { users } from '../identity/index.js';
import { memberships, type Membership } from './households.schema.js';

export interface MemberRow {
  userId: string;
  displayName: string;
  email: string;
  role: HouseholdRole;
  joinedAt: Date;
}

@Injectable()
export class MembershipsRepository {
  constructor(@Inject(DATABASE) private readonly connection: DatabaseConnection) {}

  async find(householdId: string, userId: string): Promise<Membership | undefined> {
    const [row] = await this.connection.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.householdId, householdId), eq(memberships.userId, userId)));
    return row;
  }

  /** The members of the household by name. */
  async listMembers(householdId: string): Promise<MemberRow[]> {
    return this.connection.db
      .select({
        userId: users.id,
        displayName: users.displayName,
        email: users.email,
        role: memberships.role,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.householdId, householdId))
      .orderBy(users.displayName, users.id);
  }

  /** Changes or removes one membership; a household always keeps at least one owner (spec 3.7). */
  async change(
    householdId: string,
    userId: string,
    next: HouseholdRole | 'removed',
  ): Promise<void> {
    await this.connection.db.transaction(async (tx) => {
      // Lock every membership of the household: two owners demoting each other at the same time
      // must not leave the household without an owner.
      const rows = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.householdId, householdId))
        .for('update');
      const target = rows.find((row) => row.userId === userId);
      if (!target) throw new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');
      const ownersAfter = rows.filter((row) =>
        row.userId === userId ? next === 'owner' : row.role === 'owner',
      ).length;
      if (ownersAfter === 0) throw new ApiError(HttpStatus.CONFLICT, 'household.lastOwner');
      const own = and(eq(memberships.householdId, householdId), eq(memberships.userId, userId));
      if (next === 'removed') {
        await tx.delete(memberships).where(own);
      } else {
        await tx.update(memberships).set({ role: next }).where(own);
      }
    });
  }
}
