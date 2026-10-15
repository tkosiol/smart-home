import { Injectable, inject } from '@angular/core';
import type { AttentionItem, AttentionList, Device } from '@smart/contracts';
import { API_BASE, ApiClient } from '../../core/api';

/** What the calm row of the status block says about the devices of the household. */
export interface DeviceSummary {
  readonly count: number;
  /** The newest report of any device (ISO 8601 UTC), or null while none has reported. */
  readonly lastSeenAt: string | null;
}

/** The notices of one household, and the few device facts the calm row needs. */
@Injectable({ providedIn: 'root' })
export class AttentionApi {
  private readonly api = inject(ApiClient);

  /** Sorted by severity, then newest first: the server does that, so the app keeps the order. */
  async list(householdId: string): Promise<AttentionItem[]> {
    const answer = await this.api.get<AttentionList>(
      `${API_BASE}/households/${householdId}/attention`,
    );
    return answer.items;
  }

  async deviceSummary(householdId: string): Promise<DeviceSummary> {
    const devices = await this.api.get<Device[]>(`${API_BASE}/households/${householdId}/devices`);
    // ISO strings in UTC compare like the instants they are.
    const lastSeenAt = devices.reduce<string | null>(
      (latest, device) =>
        device.lastSeenAt !== null && (latest === null || device.lastSeenAt > latest)
          ? device.lastSeenAt
          : latest,
      null,
    );
    return { count: devices.length, lastSeenAt };
  }
}
