import { Injectable, inject } from '@angular/core';
import type { Device, DeviceCreate, DeviceRename, Hardware } from '@smart/contracts';
import { API_BASE, ApiClient } from '../../core/api';

/** The device endpoints of one household (owner to list new hardware and add, members rename). */
@Injectable({ providedIn: 'root' })
export class DevicesApi {
  private readonly api = inject(ApiClient);

  private path(householdId: string, rest: string): string {
    return `${API_BASE}/households/${householdId}${rest}`;
  }

  unassignedHardware(householdId: string): Promise<Hardware[]> {
    return this.api.get<Hardware[]>(this.path(householdId, '/hardware?state=unassigned'));
  }

  add(householdId: string, body: DeviceCreate): Promise<Device> {
    return this.api.post<Device>(this.path(householdId, '/devices'), body);
  }

  list(householdId: string): Promise<Device[]> {
    return this.api.get<Device[]>(this.path(householdId, '/devices'));
  }

  get(householdId: string, deviceId: string): Promise<Device> {
    return this.api.get<Device>(this.path(householdId, `/devices/${encodeURIComponent(deviceId)}`));
  }

  rename(householdId: string, deviceId: string, body: DeviceRename): Promise<Device> {
    return this.api.patch<Device>(
      this.path(householdId, `/devices/${encodeURIComponent(deviceId)}`),
      body,
    );
  }
}
