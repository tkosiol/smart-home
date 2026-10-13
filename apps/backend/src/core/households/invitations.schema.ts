import { HOUSEHOLD_ROLES } from '@smart/contracts';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '../identity/index.js';
import { households } from './households.schema.js';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Stored normalized (`normalizeEmail`). */
    email: text('email').notNull(),
    role: text('role', { enum: HOUSEHOLD_ROLES }).notNull(),
    /** SHA-256 of the token in the link; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at').notNull(),
    acceptedAt: timestamptz('accepted_at'),
    revokedAt: timestamptz('revoked_at'),
  },
  (table) => [
    index('invitations_household_id_email_idx').on(table.householdId, table.email),
    // Roles are constants from the contracts, never user input, so they may be inlined.
    check(
      'invitations_role_check',
      sql`${table.role} in (${sql.raw(HOUSEHOLD_ROLES.map((role) => `'${role}'`).join(', '))})`,
    ),
  ],
);

export type InvitationRow = typeof invitations.$inferSelect;
