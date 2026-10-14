import { Inject, Injectable } from '@nestjs/common';
import type { Availability, Capability } from '@smart/contracts';
import { and, asc, eq, exists, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { DATABASE, type DatabaseConnection } from '../../platform/database/index.js';
import { gateways } from '../gateways/index.js';
import {
  capabilities,
  deviceBindings,
  devices,
  deviceState,
  hardware,
  type DeviceBindingRow,
  type DeviceRow,
} from './devices.schema.js';
import { toCapability } from './hardware.repository.js';

/** A device as the household sees it: its state and what its hardware measures. */
export interface DeviceView {
  id: string;
  name: string;
  icon: string | null;
  createdAt: Date;
  hardware: { id: string; vendor: string; model: string; description: string | null };
  availability: Availability;
  lastSeenAt: Date | null;
  state: Record<string, unknown>;
  /** Readable capabilities without settings. */
  capabilities: Capability[];
}

export type CreateDeviceOutcome =
  | { outcome: 'created'; device: DeviceRow }
  /** No such hardware, or it belongs to another household, is removed or its gateway revoked. */
  | { outcome: 'hardware-not-found' }
  | { outcome: 'hardware-bound' };

/** Rolls the transaction back from inside; never leaves the repository. */
class HardwareBound extends Error {}

@Injectable()
export class DevicesRepository {
  constructor(@Inject(DATABASE) private readonly connection: DatabaseConnection) {}

  /**
   * Makes a device of the household out of a piece of hardware of its gateways, bound to it, with
   * the hardware's last state as the device's first state. Of two requests for the same hardware
   * the partial unique index lets exactly one succeed; nothing is left behind by the other.
   */
  async createWithBinding(
    householdId: string,
    hardwareId: string,
    name: string,
  ): Promise<CreateDeviceOutcome> {
    try {
      return await this.connection.db.transaction(async (tx) => {
        const [source] = await tx
          .select({
            lastState: hardware.lastState,
            availability: hardware.availability,
            lastSeenAt: hardware.lastSeenAt,
          })
          .from(hardware)
          .innerJoin(gateways, eq(gateways.id, hardware.gatewayId))
          .where(
            and(
              eq(hardware.id, hardwareId),
              eq(gateways.householdId, householdId),
              isNull(gateways.revokedAt),
              isNull(hardware.removedAt),
            ),
          );
        if (!source) return { outcome: 'hardware-not-found' } as const;
        const [device] = await tx.insert(devices).values({ householdId, name }).returning();
        if (!device) throw new Error('device insert returned no row');
        // A concurrent binding of the same hardware makes this wait, then do nothing.
        const bound = await tx
          .insert(deviceBindings)
          .values({ deviceId: device.id, hardwareId })
          .onConflictDoNothing()
          .returning({ id: deviceBindings.id });
        if (bound.length === 0) throw new HardwareBound();
        await tx.insert(deviceState).values({
          deviceId: device.id,
          state: source.lastState,
          lastSeenAt: source.lastSeenAt,
          availability: source.availability,
        });
        return { outcome: 'created', device } as const;
      });
    } catch (error) {
      if (error instanceof HardwareBound) return { outcome: 'hardware-bound' };
      throw error;
    }
  }

  /** The household's devices by name, archived ones left out. */
  async list(householdId: string): Promise<DeviceView[]> {
    return this.views(eq(devices.householdId, householdId));
  }

  async get(householdId: string, deviceId: string): Promise<DeviceView | undefined> {
    const [view] = await this.views(
      and(eq(devices.householdId, householdId), eq(devices.id, deviceId)),
    );
    return view;
  }

  /**
   * Renames the household's device and returns it; `undefined` if the household has no such device.
   * Only a device that is shown (on an active binding) can be renamed, so that a successful
   * rename always has a device to return.
   */
  async rename(
    householdId: string,
    deviceId: string,
    name: string,
  ): Promise<DeviceView | undefined> {
    const renamed = await this.connection.db
      .update(devices)
      .set({ name })
      .where(
        and(
          eq(devices.id, deviceId),
          eq(devices.householdId, householdId),
          isNull(devices.archivedAt),
          exists(
            this.connection.db
              .select({ one: sql`1` })
              .from(deviceBindings)
              .where(
                and(eq(deviceBindings.deviceId, devices.id), isNull(deviceBindings.unboundAt)),
              ),
          ),
        ),
      )
      .returning({ id: devices.id });
    if (renamed.length === 0) return undefined;
    return this.get(householdId, deviceId);
  }

  /** The binding that currently ties a device to the hardware. */
  async activeBindingForHardware(hardwareId: string): Promise<DeviceBindingRow | undefined> {
    const [row] = await this.connection.db
      .select()
      .from(deviceBindings)
      .where(and(eq(deviceBindings.hardwareId, hardwareId), isNull(deviceBindings.unboundAt)));
    return row;
  }

  /**
   * Merges what the hardware reported into the device's state and moves its time to `at`, unless
   * the stored state is newer: a late delivery never overwrites a newer state. Returns whether the
   * state was updated.
   */
  async recordState(deviceId: string, state: Record<string, unknown>, at: Date): Promise<boolean> {
    const updated = await this.connection.db
      .update(deviceState)
      .set({
        state: sql`${deviceState.state} || ${JSON.stringify(state)}::jsonb`,
        lastSeenAt: at,
      })
      .where(
        and(
          eq(deviceState.deviceId, deviceId),
          or(isNull(deviceState.lastSeenAt), lte(deviceState.lastSeenAt, at)),
        ),
      )
      .returning({ deviceId: deviceState.deviceId });
    return updated.length > 0;
  }

  /** Devices on their active binding; a device without one has nothing to show and is skipped. */
  private async views(where: ReturnType<typeof and>): Promise<DeviceView[]> {
    const rows = await this.connection.db
      .select({
        device: devices,
        hardware: {
          id: hardware.id,
          vendor: hardware.vendor,
          model: hardware.model,
          description: hardware.description,
        },
        state: deviceState,
      })
      .from(devices)
      .innerJoin(
        deviceBindings,
        and(eq(deviceBindings.deviceId, devices.id), isNull(deviceBindings.unboundAt)),
      )
      .innerJoin(hardware, eq(hardware.id, deviceBindings.hardwareId))
      .leftJoin(deviceState, eq(deviceState.deviceId, devices.id))
      .where(and(where, isNull(devices.archivedAt)))
      .orderBy(asc(devices.name), asc(devices.id));
    if (rows.length === 0) return [];
    const measured = await this.connection.db
      .select()
      .from(capabilities)
      .where(
        and(
          inArray(
            capabilities.hardwareId,
            rows.map((row) => row.hardware.id),
          ),
          eq(capabilities.readable, true),
          eq(capabilities.isSetting, false),
        ),
      )
      .orderBy(asc(capabilities.key));
    return rows.map((row) => ({
      id: row.device.id,
      name: row.device.name,
      icon: row.device.icon,
      createdAt: row.device.createdAt,
      hardware: row.hardware,
      availability: row.state?.availability ?? 'unknown',
      lastSeenAt: row.state?.lastSeenAt ?? null,
      state: row.state?.state ?? {},
      capabilities: measured
        .filter((capability) => capability.hardwareId === row.hardware.id)
        .map(toCapability),
    }));
  }
}
