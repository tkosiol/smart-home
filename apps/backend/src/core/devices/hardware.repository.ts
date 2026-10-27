import { Inject, Injectable } from '@nestjs/common';
import type { Availability, Capability } from '@smart/contracts';
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DATABASE, type DatabaseConnection } from '../../platform/database/index.js';
import { gateways } from '../gateways/index.js';
import {
  capabilities,
  deviceBindings,
  deviceState,
  devices,
  hardware,
  type CapabilityRow,
  type HardwareRow,
} from './devices.schema.js';

/** One device of Zigbee2MQTT's `bridge/devices`, reduced to what is stored. */
export interface Z2mDevice {
  ieeeAddress: string;
  friendlyName: string;
  vendor: string;
  model: string;
  description: string | null;
  /** The whole Z2M definition including `exposes`, kept as reported. */
  definition: unknown;
  interviewState: string;
  /** What the definition's `exposes` amount to. */
  capabilities: readonly Capability[];
}

export interface HardwareWithCapabilities extends HardwareRow {
  capabilities: Capability[];
}

export const toCapability = (row: CapabilityRow): Capability => ({
  key: row.key,
  kind: row.kind,
  unit: row.unit,
  min: row.min,
  max: row.max,
  step: row.step,
  enumValues: row.enumValues,
  readable: row.readable,
  writable: row.writable,
  isSetting: row.isSetting,
});

/** The new value of a column in `insert … on conflict do update`. */
const excluded = (column: PgColumn) => sql.raw(`excluded."${column.name}"`);

@Injectable()
export class HardwareRepository {
  constructor(@Inject(DATABASE) private readonly connection: DatabaseConnection) {}

  /**
   * Makes the gateway's hardware match what the bridge lists: new hardware is added, known
   * hardware (by IEEE address) gets its name, model and capabilities updated and is revived if it
   * was removed, hardware that is no longer listed is marked removed. Hardware stays stored so
   * that devices keep their history. `ids` are the hardware that was added, updated or removed.
   */
  async upsertFromBridge(
    gatewayId: string,
    devices: readonly Z2mDevice[],
    now: Date,
  ): Promise<{ upserted: number; removed: number; ids: string[] }> {
    // One row per IEEE address (the last entry wins): an upsert cannot touch a row twice.
    const listed = [...new Map(devices.map((device) => [device.ieeeAddress, device])).values()];
    return this.connection.db.transaction(async (tx) => {
      const ids: string[] = [];
      if (listed.length > 0) {
        const rows = await tx
          .insert(hardware)
          .values(
            listed.map((device) => ({
              gatewayId,
              ieeeAddress: device.ieeeAddress,
              friendlyName: device.friendlyName,
              vendor: device.vendor,
              model: device.model,
              description: device.description,
              definition: device.definition,
              interviewState: device.interviewState,
              firstSeenAt: now,
            })),
          )
          .onConflictDoUpdate({
            target: [hardware.gatewayId, hardware.ieeeAddress],
            set: {
              friendlyName: excluded(hardware.friendlyName),
              vendor: excluded(hardware.vendor),
              model: excluded(hardware.model),
              description: excluded(hardware.description),
              definition: excluded(hardware.definition),
              interviewState: excluded(hardware.interviewState),
              removedAt: null,
            },
          })
          .returning({ id: hardware.id, ieeeAddress: hardware.ieeeAddress });
        ids.push(...rows.map((row) => row.id));
        const idOf = new Map(rows.map((row) => [row.ieeeAddress, row.id]));
        await tx.delete(capabilities).where(
          inArray(
            capabilities.hardwareId,
            rows.map((row) => row.id),
          ),
        );
        // One statement for the whole bridge: a gateway has tens of devices, not thousands.
        const capabilityRows = listed.flatMap((device) =>
          device.capabilities.map((capability) => ({
            hardwareId: idOf.get(device.ieeeAddress) ?? '',
            key: capability.key,
            kind: capability.kind,
            unit: capability.unit,
            min: capability.min,
            max: capability.max,
            step: capability.step,
            enumValues: capability.enumValues === null ? null : [...capability.enumValues],
            readable: capability.readable,
            writable: capability.writable,
            isSetting: capability.isSetting,
          })),
        );
        if (capabilityRows.length > 0) {
          // A key twice in one definition (e.g. a composite and its member) keeps the first.
          await tx.insert(capabilities).values(capabilityRows).onConflictDoNothing();
        }
      }
      const gone = await tx
        .update(hardware)
        .set({ removedAt: now })
        .where(
          and(
            eq(hardware.gatewayId, gatewayId),
            isNull(hardware.removedAt),
            listed.length > 0
              ? notInArray(
                  hardware.ieeeAddress,
                  listed.map((device) => device.ieeeAddress),
                )
              : undefined,
          ),
        )
        .returning({ id: hardware.id });
      ids.push(...gone.map((row) => row.id));
      return { upserted: listed.length, removed: gone.length, ids };
    });
  }

  /** The names of the gateway's hardware that its bridge still lists, with their hardware IDs. */
  async listNames(gatewayId: string): Promise<{ id: string; friendlyName: string }[]> {
    return this.connection.db
      .select({ id: hardware.id, friendlyName: hardware.friendlyName })
      .from(hardware)
      .where(and(eq(hardware.gatewayId, gatewayId), isNull(hardware.removedAt)));
  }

  /**
   * Hardware that just joined (`device_joined`): added with a pending interview, or revived and
   * renamed if it is known. The bridge's next device list fills in model and capabilities.
   */
  async recordJoined(
    gatewayId: string,
    ieeeAddress: string,
    friendlyName: string,
    now: Date,
  ): Promise<string> {
    const [row] = await this.connection.db
      .insert(hardware)
      .values({ gatewayId, ieeeAddress, friendlyName, interviewState: 'PENDING', firstSeenAt: now })
      .onConflictDoUpdate({
        target: [hardware.gatewayId, hardware.ieeeAddress],
        set: { friendlyName, removedAt: null },
      })
      .returning({ id: hardware.id });
    if (!row) throw new Error('hardware upsert returned no row');
    return row.id;
  }

  /**
   * Stores how far the interview of known hardware is (`device_interview`); its ID, `undefined`
   * if the gateway does not have it.
   */
  async setInterviewState(
    gatewayId: string,
    ieeeAddress: string,
    interviewState: string,
  ): Promise<string | undefined> {
    const [row] = await this.connection.db
      .update(hardware)
      .set({ interviewState })
      .where(and(eq(hardware.gatewayId, gatewayId), eq(hardware.ieeeAddress, ieeeAddress)))
      .returning({ id: hardware.id });
    return row?.id;
  }

  /** Marks hardware as removed (`device_leave`); returns its name, `undefined` if it is unknown. */
  async markLeft(
    gatewayId: string,
    ieeeAddress: string,
    now: Date,
  ): Promise<{ id: string; friendlyName: string } | undefined> {
    const [row] = await this.connection.db
      .update(hardware)
      .set({ removedAt: now })
      .where(
        and(
          eq(hardware.gatewayId, gatewayId),
          eq(hardware.ieeeAddress, ieeeAddress),
          isNull(hardware.removedAt),
        ),
      )
      .returning({ id: hardware.id, friendlyName: hardware.friendlyName });
    return row;
  }

  /** Renames the gateway's hardware (`device_renamed`); its ID, `undefined` if there is none. */
  async rename(gatewayId: string, from: string, to: string): Promise<string | undefined> {
    const [row] = await this.connection.db
      .update(hardware)
      .set({ friendlyName: to })
      .where(
        and(
          eq(hardware.gatewayId, gatewayId),
          eq(hardware.friendlyName, from),
          isNull(hardware.removedAt),
        ),
      )
      .returning({ id: hardware.id });
    return row?.id;
  }

  /**
   * Stores the availability of the hardware and of the device that sits on it; returns the device
   * (none for free hardware) with its household.
   */
  async setAvailability(
    hardwareId: string,
    availability: Availability,
  ): Promise<{ deviceId: string; householdId: string }[]> {
    return this.connection.db.transaction(async (tx) => {
      await tx.update(hardware).set({ availability }).where(eq(hardware.id, hardwareId));
      const touched = await tx
        .update(deviceState)
        .set({ availability })
        .where(
          inArray(
            deviceState.deviceId,
            tx
              .select({ id: deviceBindings.deviceId })
              .from(deviceBindings)
              .where(
                and(eq(deviceBindings.hardwareId, hardwareId), isNull(deviceBindings.unboundAt)),
              ),
          ),
        )
        .returning({ deviceId: deviceState.deviceId });
      if (touched.length === 0) return [];
      return tx
        .select({ deviceId: devices.id, householdId: devices.householdId })
        .from(devices)
        .where(
          inArray(
            devices.id,
            touched.map((row) => row.deviceId),
          ),
        );
    });
  }

  /**
   * Merges what the hardware reported into its last state and notes when it was reported (`at`).
   * A report older than the time already stored is left out, so that a late delivery does not
   * overwrite a newer state; with `strictlyNewer` an equal time is left out too (a retained copy
   * of what was seen already). Returns whether the state was updated.
   */
  async recordState(
    hardwareId: string,
    state: Record<string, unknown>,
    at: Date,
    options: { strictlyNewer?: boolean } = {},
  ): Promise<boolean> {
    const newer = options.strictlyNewer
      ? lt(hardware.lastSeenAt, at)
      : lte(hardware.lastSeenAt, at);
    const updated = await this.connection.db
      .update(hardware)
      .set({
        lastState: sql`${hardware.lastState} || ${JSON.stringify(state)}::jsonb`,
        lastSeenAt: at,
      })
      .where(and(eq(hardware.id, hardwareId), or(isNull(hardware.lastSeenAt), newer)))
      .returning({ id: hardware.id });
    return updated.length > 0;
  }

  /** What the hardware reports and accepts. */
  async capabilitiesOf(hardwareId: string): Promise<Capability[]> {
    const rows = await this.connection.db
      .select()
      .from(capabilities)
      .where(eq(capabilities.hardwareId, hardwareId))
      .orderBy(asc(capabilities.key));
    return rows.map(toCapability);
  }

  /** The gateway's hardware of that name (Z2M keeps names unique per bridge); not removed ones. */
  async findByName(
    gatewayId: string,
    friendlyName: string,
  ): Promise<HardwareWithCapabilities | undefined> {
    const rows = await this.connection.db
      .select()
      .from(hardware)
      .where(
        and(
          eq(hardware.gatewayId, gatewayId),
          eq(hardware.friendlyName, friendlyName),
          isNull(hardware.removedAt),
        ),
      );
    return (await this.withCapabilities(rows))[0];
  }

  /**
   * Hardware of the household's gateways that is listed by its bridge and not part of a device
   * yet; hardware of revoked gateways is left out. By name.
   */
  async listUnassigned(householdId: string): Promise<HardwareWithCapabilities[]> {
    const rows = await this.connection.db
      .select({ hardware })
      .from(hardware)
      .innerJoin(gateways, eq(gateways.id, hardware.gatewayId))
      .where(
        and(
          eq(gateways.householdId, householdId),
          isNull(gateways.revokedAt),
          isNull(hardware.removedAt),
          notExists(
            this.connection.db
              .select({ one: sql`1` })
              .from(deviceBindings)
              .where(
                and(eq(deviceBindings.hardwareId, hardware.id), isNull(deviceBindings.unboundAt)),
              ),
          ),
        ),
      )
      .orderBy(asc(hardware.friendlyName), asc(hardware.id));
    return this.withCapabilities(rows.map((row) => row.hardware));
  }

  /**
   * The household the hardware belongs to (through its gateway) and the hardware as the household
   * lists it as new: `listed` is `null` once it is removed, assigned to a device or its gateway is
   * revoked. `undefined` if the hardware or its gateway is unknown.
   */
  async listingOf(
    hardwareId: string,
  ): Promise<{ householdId: string; listed: HardwareWithCapabilities | null } | undefined> {
    const [row] = await this.connection.db
      .select({ hardware, householdId: gateways.householdId, revokedAt: gateways.revokedAt })
      .from(hardware)
      .innerJoin(gateways, eq(gateways.id, hardware.gatewayId))
      .where(eq(hardware.id, hardwareId));
    if (!row) return undefined;
    const [binding] = await this.connection.db
      .select({ id: deviceBindings.id })
      .from(deviceBindings)
      .where(and(eq(deviceBindings.hardwareId, hardwareId), isNull(deviceBindings.unboundAt)));
    if (row.revokedAt !== null || row.hardware.removedAt !== null || binding) {
      return { householdId: row.householdId, listed: null };
    }
    const [listed] = await this.withCapabilities([row.hardware]);
    return { householdId: row.householdId, listed: listed ?? null };
  }

  private async withCapabilities(rows: HardwareRow[]): Promise<HardwareWithCapabilities[]> {
    if (rows.length === 0) return [];
    const found = await this.connection.db
      .select()
      .from(capabilities)
      .where(
        inArray(
          capabilities.hardwareId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(capabilities.key));
    return rows.map((row) => ({
      ...row,
      capabilities: found.filter((c) => c.hardwareId === row.id).map(toCapability),
    }));
  }
}
