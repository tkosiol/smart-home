import { HOUSEHOLD_ROLES } from '@smart/contracts';
import { check, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '../identity/index.js';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const households = pgTable('households', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** IANA time zone name. */
  timezone: text('timezone').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: HOUSEHOLD_ROLES }).notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.householdId, table.userId] }),
    index('memberships_user_id_idx').on(table.userId),
    // Roles are constants from the contracts, never user input, so they may be inlined.
    check(
      'memberships_role_check',
      sql`${table.role} in (${sql.raw(HOUSEHOLD_ROLES.map((role) => `'${role}'`).join(', '))})`,
    ),
  ],
);

export type Household = typeof households.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
