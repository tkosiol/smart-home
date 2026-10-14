import { EventEmitter } from 'node:events';
import type { GatewayStatus } from '@smart/contracts';
import type { GatewayStatusKind } from './gateway-status-memory.js';

export const GATEWAY_STATUS_CHANGED = 'gateway.status-changed';
export const GATEWAY_REGISTERED = 'gateway.registered';
export const GATEWAY_REVOKED = 'gateway.revoked';

export interface GatewayStatusChanged {
  gatewayId: string;
  kind: GatewayStatusKind;
  status: GatewayStatus;
  at: Date;
}

export interface GatewayRegistered {
  gatewayId: string;
  topicPrefix: string;
}

export interface GatewayRevoked {
  gatewayId: string;
}

/** The module's own event bus; listeners are added by later stages (`on(GATEWAY_STATUS_CHANGED)`, `on(GATEWAY_REGISTERED)`, `on(GATEWAY_REVOKED)`). */
export class GatewayEvents extends EventEmitter {}
