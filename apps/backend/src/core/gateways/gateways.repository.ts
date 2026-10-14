import { Inject, Injectable } from '@nestjs/common';
import type { GatewayStatus } from '@smart/contracts';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { DATABASE, type DatabaseConnection } from '../../platform/database/index.js';
import type { GatewayStatusKind } from './gateway-status-memory.js';
import { gateways, type GatewayRow, type NewGatewayRow } from './gateways.schema.js';

export type StatusOutcome = 'changed' | 'unchanged' | 'ignored';

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

  /** Every gateway that is not revoked. */
  async listActive(): Promise<GatewayRow[]> {
    return this.connection.db
      .select()
      .from(gateways)
      .where(isNull(gateways.revokedAt))
      .orderBy(asc(gateways.createdAt), asc(gateways.id));
  }

  /**
   * Stores a reported status of a gateway that is registered and not revoked. `status_changed_at`
   * moves only when the status differs; `ignored` means there is no such gateway to write to.
   */
  async applyStatus(
    id: string,
    kind: GatewayStatusKind,
    status: GatewayStatus,
    now: Date,
  ): Promise<StatusOutcome> {
    const column = kind === 'bridge' ? gateways.bridgeStatus : gateways.z2mStatus;
    const active = and(eq(gateways.id, id), isNull(gateways.revokedAt));
    const changed = await this.connection.db
      .update(gateways)
      .set({
        ...(kind === 'bridge' ? { bridgeStatus: status } : { z2mStatus: status }),
        statusChangedAt: now,
      })
      .where(and(active, ne(column, status)))
      .returning({ id: gateways.id });
    if (changed.length > 0) return 'changed';
    const [present] = await this.connection.db
      .select({ id: gateways.id })
      .from(gateways)
      .where(active);
    return present ? 'unchanged' : 'ignored';
  }

  /** Records that a message arrived; `false` if there is no registered, unrevoked gateway. */
  async touch(id: string, now: Date): Promise<boolean> {
    const rows = await this.connection.db
      .update(gateways)
      .set({ lastMessageAt: now })
      .where(and(eq(gateways.id, id), isNull(gateways.revokedAt)))
      .returning({ id: gateways.id });
    return rows.length > 0;
  }
}
