import { Inject, Injectable } from '@nestjs/common';
import type { Capability } from '@smart/contracts';
import { and, asc, eq, inArray, isNull, notExists, notInArray, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DATABASE, type DatabaseConnection } from '../../platform/database/index.js';
import { gateways } from '../gateways/index.js';
import {
  capabilities,
  deviceBindings,
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
   * that devices keep their history.
   */
  async upsertFromBridge(
    gatewayId: string,
    devices: readonly Z2mDevice[],
    now: Date,
  ): Promise<{ upserted: number; removed: number }> {
    // One row per IEEE address (the last entry wins): an upsert cannot touch a row twice.
    const listed = [...new Map(devices.map((device) => [device.ieeeAddress, device])).values()];
    return this.connection.db.transaction(async (tx) => {
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
      return { upserted: listed.length, removed: gone.length };
    });
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
