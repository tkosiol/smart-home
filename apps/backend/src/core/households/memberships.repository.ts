import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type DatabaseConnection } from '../../platform/database/index.js';
import { memberships, type Membership } from './households.schema.js';

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
}
