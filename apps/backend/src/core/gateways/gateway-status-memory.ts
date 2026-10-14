import type { GatewayStatus } from '@smart/contracts';

/** What was last heard from a gateway over MQTT, kept for gateways that are not registered yet. */
export interface RecalledStatus {
  bridge?: GatewayStatus;
  z2m?: GatewayStatus;
  /** When the status last changed. */
  at?: Date;
}

export interface GatewayStatusMemory {
  recall(id: string): RecalledStatus | undefined;
}

export const GATEWAY_STATUS_MEMORY = Symbol('GATEWAY_STATUS_MEMORY');

/** The default: nothing is remembered (the MQTT status consumer replaces it). */
export const noStatusMemory: GatewayStatusMemory = { recall: () => undefined };
