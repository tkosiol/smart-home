import { DEFAULT_PERSONAL_APPEARANCE, LANGUAGES, type PersonalAppearance } from '@smart/contracts';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const AUTH_METHODS = ['email_code', 'passkey', 'recovery', 'invitation'] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stored lowercase (`normalizeEmail`). */
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  locale: text('locale', { enum: LANGUAGES }).notNull().default('de'),
  appearance: jsonb('appearance')
    .$type<PersonalAppearance>()
    .notNull()
    .default(DEFAULT_PERSONAL_APPEARANCE),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** SHA-256 of the cookie token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    authMethod: text('auth_method', { enum: AUTH_METHODS }).notNull(),
    userAgent: text('user_agent').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    lastSeenAt: timestamptz('last_seen_at').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    absoluteExpiresAt: timestamptz('absolute_expires_at').notNull(),
    revokedAt: timestamptz('revoked_at'),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

export const emailLoginCodes = pgTable(
  'email_login_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    browserNonceHash: text('browser_nonce_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamptz('expires_at').notNull(),
    usedAt: timestamptz('used_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [index('email_login_codes_email_idx').on(table.email)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
