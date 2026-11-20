import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { households } from '../../households/index.js';
import { users } from '../../identity/index.js';
import { gateways } from '../gateways.schema.js';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Pairing codes for gateways with credentials access; only the hash of a code is stored. */
export const gatewayPairings = pgTable(
  'gateway_pairings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The household of the new gateway, or of the existing one that is paired anew. */
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Set when an existing gateway is paired anew. */
    gatewayId: text('gateway_id').references(() => gateways.id, { onDelete: 'cascade' }),
    /** SHA-256 of the normalized code; the code itself is never stored. */
    codeHash: text('code_hash').notNull().unique(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
  },
  (table) => [index('gateway_pairings_household_id_idx').on(table.householdId)],
);

export type GatewayPairingRow = typeof gatewayPairings.$inferSelect;
export type NewGatewayPairingRow = typeof gatewayPairings.$inferInsert;
