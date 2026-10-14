import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DATABASE, type DatabaseConnection } from '../../platform/database/index.js';
import { gateways, type GatewayRow, type NewGatewayRow } from './gateways.schema.js';

@Injectable()
export class GatewaysRepository {
  constructor(@Inject(DATABASE) private readonly connection: DatabaseConnection) {}

  /** Stores the gateway; `undefined` when the ID is taken, whichever household holds it. */
  async insert(values: NewGatewayRow): Promise<GatewayRow | undefined> {
    const [row] = await this.connection.db
      .insert(gateways)
      .values(values)
      .onConflictDoNothing({ target: gateways.id })
      .returning();
    return row;
  }

  /** The household's gateways, oldest first. */
  async listByHousehold(householdId: string): Promise<GatewayRow[]> {
    return this.connection.db
      .select()
      .from(gateways)
      .where(eq(gateways.householdId, householdId))
      .orderBy(asc(gateways.createdAt), asc(gateways.id));
  }

  /** Marks the household's gateway as revoked (the first time stays); `false` if it has none such. */
  async revoke(householdId: string, id: string, now: Date): Promise<boolean> {
    const rows = await this.connection.db
      .update(gateways)
      .set({ revokedAt: sql`coalesce(${gateways.revokedAt}, ${now.toISOString()}::timestamptz)` })
      .where(and(eq(gateways.id, id), eq(gateways.householdId, householdId)))
      .returning({ id: gateways.id });
    return rows.length > 0;
  }
}
