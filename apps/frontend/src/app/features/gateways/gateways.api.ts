import { Injectable, inject } from '@angular/core';
import type { Gateway, GatewayRegister } from '@smart/contracts';
import { API_BASE, ApiClient } from '../../core/api';

/** The gateway endpoints of one household (owner to list, platform admin to register and revoke). */
@Injectable({ providedIn: 'root' })
export class GatewaysApi {
  private readonly api = inject(ApiClient);

  private path(householdId: string, rest = ''): string {
    return `${API_BASE}/households/${householdId}/gateways${rest}`;
  }

  list(householdId: string): Promise<Gateway[]> {
    return this.api.get<Gateway[]>(this.path(householdId));
  }

  register(householdId: string, body: GatewayRegister): Promise<Gateway> {
    return this.api.post<Gateway>(this.path(householdId), body);
  }

  revoke(householdId: string, gatewayId: string): Promise<void> {
    return this.api.post<void>(this.path(householdId, `/${gatewayId}/revoke`));
  }
}
