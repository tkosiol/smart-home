import { HttpStatus, Injectable } from '@nestjs/common';
import {
  effectiveThresholds,
  type Device,
  type DeviceCreate,
  type DeviceUpdate,
  type Hardware,
  type Thresholds,
} from '@smart/contracts';
import { ApiError } from '../../platform/http/index.js';
import { isUuid } from '../households/index.js';
import {
  DEVICE_CHANGED,
  DEVICE_THRESHOLDS_CHANGED,
  DeviceEvents,
  HARDWARE_CHANGED,
  type DeviceChanged,
  type HardwareChanged,
} from './device-events.js';
import { DevicesRepository, type DeviceView } from './devices.repository.js';
import { HardwareRepository, type HardwareWithCapabilities } from './hardware.repository.js';

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

export const toHardware = (row: HardwareWithCapabilities): Hardware => ({
  id: row.id,
  gatewayId: row.gatewayId,
  ieeeAddress: row.ieeeAddress,
  friendlyName: row.friendlyName,
  vendor: row.vendor,
  model: row.model,
  description: row.description,
  availability: row.availability,
  lastSeenAt: iso(row.lastSeenAt),
  lastState: row.lastState,
  capabilities: row.capabilities,
});

export const toDevice = (view: DeviceView): Device => ({
  id: view.id,
  name: view.name,
  icon: view.icon,
  hardware: view.hardware,
  availability: view.availability,
  lastSeenAt: iso(view.lastSeenAt),
  state: view.state,
  capabilities: view.capabilities,
  kind: view.kind,
  thresholds: view.thresholds,
  effectiveThresholds: effectiveThresholds(view.kind, view.thresholds),
});

/** A set value overwrites the stored one, `null` removes it, a missing one stays. */
export function mergeThresholds(current: Thresholds, patch: Thresholds): Thresholds {
  const merged: Record<string, number> = {};
  for (const [key, value] of Object.entries({ ...current, ...patch })) {
    if (typeof value === 'number') merged[key] = value;
  }
  return merged;
}

const notFound = (): ApiError => new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');

/** What a household does with hardware and devices; unknown and foreign IDs answer alike. */
@Injectable()
export class DevicesService {
  constructor(
    private readonly hardware: HardwareRepository,
    private readonly devices: DevicesRepository,
    private readonly events: DeviceEvents,
  ) {}

  async listUnassignedHardware(householdId: string): Promise<Hardware[]> {
    return (await this.hardware.listUnassigned(householdId)).map(toHardware);
  }

  async create(householdId: string, input: DeviceCreate): Promise<Device> {
    if (!isUuid(input.hardwareId)) throw notFound();
    const result = await this.devices.createWithBinding(householdId, input.hardwareId, input.name);
    if (result.outcome === 'hardware-not-found') throw notFound();
    if (result.outcome === 'hardware-bound') {
      throw new ApiError(HttpStatus.CONFLICT, 'device.hardwareBound');
    }
    const view = await this.devices.get(householdId, result.device.id);
    if (!view) throw new Error('created device is not readable');
    this.events.emit(DEVICE_CHANGED, {
      householdId,
      deviceId: view.id,
    } satisfies DeviceChanged);
    // The hardware is assigned now and leaves the list of new hardware.
    this.events.emit(HARDWARE_CHANGED, { hardwareId: input.hardwareId } satisfies HardwareChanged);
    return toDevice(view);
  }

  async list(householdId: string): Promise<Device[]> {
    return (await this.devices.list(householdId)).map(toDevice);
  }

  async get(householdId: string, deviceId: string): Promise<Device> {
    const view = isUuid(deviceId) ? await this.devices.get(householdId, deviceId) : undefined;
    if (!view) throw notFound();
    return toDevice(view);
  }

  /**
   * Renames the device and/or changes its thresholds. A threshold range that ends up empty (the
   * effective minimum at or above the maximum, e.g. a new maximum below the kind's default
   * minimum) is rejected with 400, as the schema alone only sees the request.
   */
  async update(householdId: string, deviceId: string, input: DeviceUpdate): Promise<Device> {
    const { name, thresholds } = input;
    const updated = isUuid(deviceId)
      ? await this.devices.update(householdId, deviceId, {
          ...(name !== undefined && { name }),
          ...(thresholds !== undefined && {
            thresholds: (current, kind) => {
              const merged = mergeThresholds(current, thresholds);
              const effective = effectiveThresholds(kind, merged);
              if (
                effective.soilMoistureMin !== null &&
                effective.soilMoistureMax !== null &&
                effective.soilMoistureMin >= effective.soilMoistureMax
              ) {
                throw new ApiError(HttpStatus.BAD_REQUEST, 'validation.failed');
              }
              return merged;
            },
          }),
        })
      : undefined;
    if (!updated) throw notFound();
    if (updated.thresholdsChanged) {
      this.events.emit(DEVICE_THRESHOLDS_CHANGED, { householdId, deviceId });
    }
    this.events.emit(DEVICE_CHANGED, { householdId, deviceId } satisfies DeviceChanged);
    return toDevice(updated.view);
  }
}
