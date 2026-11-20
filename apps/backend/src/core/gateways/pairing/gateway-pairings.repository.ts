import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { DATABASE, type DatabaseConnection } from '../../../platform/database/index.js';
import { gatewayPairings, type GatewayPairingRow } from './gateway-pairings.schema.js';

/** The transaction a code is redeemed in. */
export type PairingTransaction = Parameters<
  Parameters<DatabaseConnection['db']['transaction']>[0]
>[0];

export interface NewPairing {
  householdId: string;
  /** Set when an existing gateway is paired anew. */
  gatewayId: string | null;
  codeHash: string;
  createdBy: string;
  now: Date;
  expiresAt: Date;
}

/** Neither redeemed nor expired at `now`. */
const open = (now: Date) => and(isNull(gatewayPairings.usedAt), gt(gatewayPairings.expiresAt, now));

@Injectable()
export class GatewayPairingsRepository {
  constructor(@Inject(DATABASE) private readonly connection: DatabaseConnection) {}

  /**
   * Stores the code and voids the open codes of the same target (spec 5.1): the household's new
   * gateway, or the same existing gateway.
   */
  async replaceOpen(pairing: NewPairing): Promise<void> {
    const { now, ...values } = pairing;
    await this.connection.db.transaction(async (tx) => {
      await tx
        .update(gatewayPairings)
        .set({ expiresAt: now })
        .where(
          and(
            open(now),
            values.gatewayId === null
              ? and(
                  eq(gatewayPairings.householdId, values.householdId),
                  isNull(gatewayPairings.gatewayId),
                )
              : eq(gatewayPairings.gatewayId, values.gatewayId),
          ),
        );
      await tx.insert(gatewayPairings).values({ ...values, createdAt: now });
    });
  }

  transaction<T>(fn: (tx: PairingTransaction) => Promise<T>): Promise<T> {
    return this.connection.db.transaction(fn);
  }

  /**
   * The open code with the hash, locked until the transaction ends: a second redeem of the same
   * code waits and then finds it used.
   */
  async lockOpen(
    tx: PairingTransaction,
    codeHash: string,
    now: Date,
  ): Promise<GatewayPairingRow | undefined> {
    const [row] = await tx
      .select()
      .from(gatewayPairings)
      .where(and(eq(gatewayPairings.codeHash, codeHash), open(now)))
      .for('update');
    return row;
  }

  async markUsed(tx: PairingTransaction, id: string, now: Date): Promise<void> {
    await tx.update(gatewayPairings).set({ usedAt: now }).where(eq(gatewayPairings.id, id));
  }

  /** Removes the codes that were redeemed or expired before `cutoff`. */
  async deleteSettledBefore(cutoff: Date): Promise<number> {
    const rows = await this.connection.db
      .delete(gatewayPairings)
      .where(or(lt(gatewayPairings.usedAt, cutoff), lt(gatewayPairings.expiresAt, cutoff)))
      .returning({ id: gatewayPairings.id });
    return rows.length;
  }
}
