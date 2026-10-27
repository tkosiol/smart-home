import { Injectable, inject } from '@angular/core';
import type {
  Device,
  DeviceCreate,
  DeviceHistory,
  DeviceUpdate,
  Hardware,
  HistoryRange,
} from '@smart/contracts';
import { API_BASE, ApiClient } from '../../core/api';

/** The device endpoints of one household (owner to list new hardware and add, members change). */
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

  /** Renames the device and/or changes thresholds; a `null` threshold sets one back to the default. */
  update(householdId: string, deviceId: string, body: DeviceUpdate): Promise<Device> {
    return this.api.patch<Device>(
      this.path(householdId, `/devices/${encodeURIComponent(deviceId)}`),
      body,
    );
  }

  /** The values of one capability over a range, in buckets (and per day over 4 weeks). */
  history(
    householdId: string,
    deviceId: string,
    capability: string,
    range: HistoryRange,
  ): Promise<DeviceHistory> {
    const query = `capability=${encodeURIComponent(capability)}&range=${range}`;
    return this.api.get<DeviceHistory>(
      this.path(householdId, `/devices/${encodeURIComponent(deviceId)}/history?${query}`),
    );
  }
}
