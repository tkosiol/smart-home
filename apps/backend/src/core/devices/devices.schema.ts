import { AVAILABILITIES, CAPABILITY_KINDS, type Thresholds } from '@smart/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { SETUP_STATES } from '../adapters/index.js';
import { gateways } from '../gateways/index.js';
import { households } from '../households/index.js';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** The values of a constant list as an SQL list; they come from the contracts, never from users. */
const inList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/** A physical device as its gateway reports it; households turn it into a device. */
export const hardware = pgTable(
  'hardware',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gatewayId: text('gateway_id')
      .notNull()
      .references(() => gateways.id, { onDelete: 'cascade' }),
    /** The gateway's stable ID of the hardware (Zigbee2MQTT: the IEEE address). */
    externalId: text('external_id').notNull(),
    /** The hardware's name in the foreign system; suggested as the device name when it is added. */
    name: text('name').notNull(),
    /** How the adapter addresses the hardware in its topics (Zigbee2MQTT: the device name); may change. */
    address: text('address'),
    vendor: text('vendor').notNull().default(''),
    model: text('model').notNull().default(''),
    description: text('description'),
    /** What the gateway's adapter reported, kept for diagnosis; only the adapter reads it. */
    native: jsonb('native').$type<Record<string, unknown>>().notNull().default({}),
    setupState: text('setup_state', { enum: SETUP_STATES }).notNull().default('unknown'),
    availability: text('availability', { enum: AVAILABILITIES }).notNull().default('unknown'),
    /** The latest merged state the hardware reported. */
    lastState: jsonb('last_state').$type<Record<string, unknown>>().notNull().default({}),
    firstSeenAt: timestamptz('first_seen_at').notNull(),
    lastSeenAt: timestamptz('last_seen_at'),
    /** Set when the gateway stops listing the hardware; cleared when it returns. */
    removedAt: timestamptz('removed_at'),
  },
  (table) => [
    uniqueIndex('hardware_gateway_id_external_id_idx').on(table.gatewayId, table.externalId),
    index('hardware_gateway_id_address_idx').on(table.gatewayId, table.address),
    check('hardware_availability_check', sql`${table.availability} in (${inList(AVAILABILITIES)})`),
    check('hardware_setup_state_check', sql`${table.setupState} in (${inList(SETUP_STATES)})`),
  ],
);

/** What a piece of hardware reports or accepts; replaced whenever its gateway lists it again. */
export const capabilities = pgTable(
  'capabilities',
  {
    hardwareId: uuid('hardware_id')
      .notNull()
      .references(() => hardware.id, { onDelete: 'cascade' }),
    /** A key of the capability vocabulary or one the adapter passes through, e.g. `soil_moisture`. */
    key: text('key').notNull(),
    kind: text('kind', { enum: CAPABILITY_KINDS }).notNull(),
    unit: text('unit'),
    min: doublePrecision('min'),
    max: doublePrecision('max'),
    step: doublePrecision('step'),
    enumValues: text('enum_values').array(),
    readable: boolean('readable').notNull(),
    writable: boolean('writable').notNull(),
    isSetting: boolean('is_setting').notNull(),
    /** What the adapter needs to read the capability from reports, e.g. `{ property }`. */
    native: jsonb('native').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    primaryKey({ columns: [table.hardwareId, table.key] }),
    check('capabilities_kind_check', sql`${table.kind} in (${inList(CAPABILITY_KINDS)})`),
  ],
);

/** A household's named device on top of a piece of hardware. */
export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon'),
    /** The device's own thresholds; a missing key uses the default of its kind. */
    thresholds: jsonb('thresholds').$type<Thresholds>().notNull().default({}),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    archivedAt: timestamptz('archived_at'),
  },
  (table) => [index('devices_household_id_idx').on(table.householdId)],
);

/** Which hardware a device currently sits on; released bindings stay as history. */
export const deviceBindings = pgTable(
  'device_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    hardwareId: uuid('hardware_id')
      .notNull()
      .references(() => hardware.id, { onDelete: 'cascade' }),
    boundAt: timestamptz('bound_at').notNull().defaultNow(),
    unboundAt: timestamptz('unbound_at'),
  },
  (table) => [
    // At most one active binding per device and per piece of hardware.
    uniqueIndex('device_bindings_active_device_idx')
      .on(table.deviceId)
      .where(sql`${table.unboundAt} is null`),
    uniqueIndex('device_bindings_active_hardware_idx')
      .on(table.hardwareId)
      .where(sql`${table.unboundAt} is null`),
  ],
);

/** The latest overall state of a device. */
export const deviceState = pgTable('device_state', {
  deviceId: uuid('device_id')
    .primaryKey()
    .references(() => devices.id, { onDelete: 'cascade' }),
  state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
  lastSeenAt: timestamptz('last_seen_at'),
  availability: text('availability', { enum: AVAILABILITIES }).notNull().default('unknown'),
});

export type HardwareRow = typeof hardware.$inferSelect;
export type NewHardwareRow = typeof hardware.$inferInsert;
export type CapabilityRow = typeof capabilities.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type DeviceBindingRow = typeof deviceBindings.$inferSelect;
export type DeviceStateRow = typeof deviceState.$inferSelect;
