import { Injectable, inject } from '@angular/core';
import type { OverviewLayout } from '@smart/contracts';
import { API_BASE, ApiClient } from '../../core/api';

/** The user's own layout of the overview in one household (every member may change theirs). */
@Injectable({ providedIn: 'root' })
export class OverviewLayoutApi {
  private readonly api = inject(ApiClient);

  private path(householdId: string): string {
    return `${API_BASE}/households/${householdId}/me/overview-layout`;
  }

  /** `null` while nothing is stored: the defaults of the blocks apply. */
  get(householdId: string): Promise<OverviewLayout | null> {
    return this.api.get<OverviewLayout | null>(this.path(householdId));
  }

  save(householdId: string, layout: OverviewLayout): Promise<OverviewLayout> {
    return this.api.put<OverviewLayout>(this.path(householdId), layout);
  }

  reset(householdId: string): Promise<void> {
    return this.api.delete(this.path(householdId));
  }
}
