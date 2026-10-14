import { HttpStatus, Injectable } from '@nestjs/common';
import type { Device, DeviceCreate, DeviceRename, Hardware } from '@smart/contracts';
import { ApiError } from '../../platform/http/index.js';
import { isUuid } from '../households/index.js';
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
});

const notFound = (): ApiError => new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');

/** What a household does with hardware and devices; unknown and foreign IDs answer alike. */
@Injectable()
export class DevicesService {
  constructor(
    private readonly hardware: HardwareRepository,
    private readonly devices: DevicesRepository,
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

  async rename(householdId: string, deviceId: string, input: DeviceRename): Promise<Device> {
    const view = isUuid(deviceId)
      ? await this.devices.rename(householdId, deviceId, input.name)
      : undefined;
    if (!view) throw notFound();
    return toDevice(view);
  }
}
