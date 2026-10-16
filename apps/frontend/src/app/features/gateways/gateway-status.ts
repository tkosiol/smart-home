import type { Gateway, GatewayStatus } from '@smart/contracts';
import type { UiStatusEntryTone } from '@smart/ui';

/**
 * One state for a gateway: online only while bridge and Zigbee2MQTT both are (the backend counts
 * the gateway as offline otherwise); unknown when nothing says offline but one of them is unknown.
 */
export function gatewayState(gateway: Gateway): GatewayStatus {
  const statuses = [gateway.bridgeStatus, gateway.z2mStatus];
  if (statuses.every((status) => status === 'online')) return 'online';
  return statuses.includes('offline') ? 'offline' : 'unknown';
}

/** The icon container per state (spec 3.6): online ok, offline the strong error, unknown grey. */
export const GATEWAY_TONE: Record<GatewayStatus, UiStatusEntryTone> = {
  online: 'ok-container',
  offline: 'error',
  unknown: 'offline-container',
};
