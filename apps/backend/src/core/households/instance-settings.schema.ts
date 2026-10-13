import type { InstanceAppearance } from '@smart/contracts';
import { check, integer, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '../identity/index.js';

/** The settings of this installation: a single row with `id = 1`. */
export const instanceSettings = pgTable(
  'instance_settings',
  {
    id: integer('id').primaryKey(),
    /** The look of the installation; `null` while nobody has set one (the app's default applies). */
    appearance: jsonb('appearance').$type<InstanceAppearance>(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [check('instance_settings_single_row_check', sql`${table.id} = 1`)],
);
