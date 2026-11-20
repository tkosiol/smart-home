import { Injectable, inject } from '@angular/core';
import type { Gateway, GatewayPairing, GatewayRegister } from '@smart/contracts';
import { API_BASE, ApiClient } from '../../core/api';

/** The gateway endpoints of one household (owner to list, pair and revoke a paired one; platform admin to register and revoke a certificate one). */
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

  /** A pairing code for Home Assistant: a new gateway, or with `gatewayId` a new key for that one. */
  createPairing(householdId: string, gatewayId?: string): Promise<GatewayPairing> {
    return this.api.post<GatewayPairing>(
      `${API_BASE}/households/${householdId}/gateway-pairings`,
      gatewayId ? { gatewayId } : {},
    );
  }

  revoke(householdId: string, gatewayId: string): Promise<void> {
    return this.api.post<void>(this.path(householdId, `/${gatewayId}/revoke`));
  }
}
