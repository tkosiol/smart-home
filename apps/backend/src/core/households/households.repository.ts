import { Inject, Injectable } from '@nestjs/common';
import type { HouseholdCreate, HouseholdUpdate } from '@smart/contracts';
import { eq, sql } from 'drizzle-orm';
import { DATABASE, type DatabaseConnection } from '../../platform/database/index.js';
import { users } from '../identity/index.js';
import { households, memberships, type Household, type Membership } from './households.schema.js';

export type HouseholdWithMembership = Household & { role: Membership['role']; joinedAt: Date };

@Injectable()
export class HouseholdsRepository {
  constructor(@Inject(DATABASE) private readonly connection: DatabaseConnection) {}

  /** Creates the household with `ownerId` as its owner and makes it the owner's current one. */
  async createWithOwner(ownerId: string, input: HouseholdCreate): Promise<Household> {
    return this.connection.db.transaction(async (tx) => {
      const [household] = await tx.insert(households).values(input).returning();
      if (!household) throw new Error('Inserting a household returned no row');
      await tx
        .insert(memberships)
        .values({ householdId: household.id, userId: ownerId, role: 'owner' });
      await tx
        .update(users)
        .set({ lastHouseholdId: household.id, updatedAt: sql`now()` })
        .where(eq(users.id, ownerId));
      return household;
    });
  }

  /** Replaces what is given; fields left out stay as they are. */
  async update(id: string, update: HouseholdUpdate): Promise<Household | undefined> {
    const values = Object.fromEntries(
      Object.entries(update).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(values).length === 0) return this.findById(id);
    const [row] = await this.connection.db
      .update(households)
      .set(values)
      .where(eq(households.id, id))
      .returning();
    return row;
  }

  async findById(id: string): Promise<Household | undefined> {
    const [row] = await this.connection.db.select().from(households).where(eq(households.id, id));
    return row;
  }

  /** The households the user is a member of, oldest membership first. */
  async listForUser(userId: string): Promise<HouseholdWithMembership[]> {
    const rows = await this.connection.db
      .select({
        id: households.id,
        name: households.name,
        timezone: households.timezone,
        createdAt: households.createdAt,
        role: memberships.role,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(households, eq(households.id, memberships.householdId))
      .where(eq(memberships.userId, userId))
      .orderBy(memberships.createdAt, households.id);
    return rows;
  }
}
