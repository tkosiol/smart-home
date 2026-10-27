import { EventEmitter } from 'node:events';
import type { GatewayStatus } from '@smart/contracts';
import type { GatewayStatusKind } from './gateway-status-memory.js';

export const GATEWAY_STATUS_CHANGED = 'gateway.status-changed';
export const GATEWAY_REGISTERED = 'gateway.registered';
export const GATEWAY_REVOKED = 'gateway.revoked';
export const GATEWAY_TOUCHED = 'gateway.touched';

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

/** The gateway sent a device message and `last_message_at` was written (at most once a minute). */
export interface GatewayTouched {
  gatewayId: string;
}

/** The module's own event bus; listeners are added by later stages (`on(GATEWAY_STATUS_CHANGED)`, `on(GATEWAY_REGISTERED)`, `on(GATEWAY_REVOKED)`, `on(GATEWAY_TOUCHED)`). */
export class GatewayEvents extends EventEmitter {}
