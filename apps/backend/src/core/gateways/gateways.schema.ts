import { GATEWAY_ID_PATTERN, GATEWAY_STATUSES } from '@smart/contracts';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { households } from '../households/index.js';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** The values of a constant list as an SQL list; they come from the contracts, never from users. */
const inList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

export const GATEWAY_KINDS = ['z2m'] as const;

export const gateways = pgTable(
  'gateways',
  {
    /** The gateway ID: also the common name of its certificate and its MQTT user name. */
    id: text('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind', { enum: GATEWAY_KINDS }).notNull().default('z2m'),
    /** Ingest and commands read the topic prefix from here (`gw/<id>/z2m`). */
    topicPrefix: text('topic_prefix').notNull(),
    bridgeStatus: text('bridge_status', { enum: GATEWAY_STATUSES }).notNull().default('unknown'),
    z2mStatus: text('z2m_status', { enum: GATEWAY_STATUSES }).notNull().default('unknown'),
    statusChangedAt: timestamptz('status_changed_at'),
    lastMessageAt: timestamptz('last_message_at'),
    /** SHA-256 of the certificate; the certificate itself is not stored. */
    certFingerprint: text('cert_fingerprint').notNull(),
    certExpiresAt: timestamptz('cert_expires_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    revokedAt: timestamptz('revoked_at'),
  },
  (table) => [
    index('gateways_household_id_idx').on(table.householdId),
    check('gateways_id_check', sql`${table.id} ~ ${sql.raw(`'${GATEWAY_ID_PATTERN.source}'`)}`),
    check('gateways_kind_check', sql`${table.kind} in (${inList(GATEWAY_KINDS)})`),
    check(
      'gateways_bridge_status_check',
      sql`${table.bridgeStatus} in (${inList(GATEWAY_STATUSES)})`,
    ),
    check('gateways_z2m_status_check', sql`${table.z2mStatus} in (${inList(GATEWAY_STATUSES)})`),
  ],
);

export type GatewayRow = typeof gateways.$inferSelect;
export type NewGatewayRow = typeof gateways.$inferInsert;
