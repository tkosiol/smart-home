import { EventEmitter } from 'node:events';
import type { GatewayStatus } from '@smart/contracts';
import type { GatewayStatusKind } from './gateway-status-memory.js';

export const GATEWAY_STATUS_CHANGED = 'gateway.status-changed';

export interface GatewayStatusChanged {
  gatewayId: string;
  kind: GatewayStatusKind;
  status: GatewayStatus;
  at: Date;
}

/** The module's own event bus; listeners are added by later stages (`on(GATEWAY_STATUS_CHANGED)`). */
export class GatewayEvents extends EventEmitter {}
