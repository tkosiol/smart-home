import type { GatewayKind, GatewayStatus } from '@smart/contracts';

/** What was last heard from a gateway over MQTT, kept for gateways that are not registered yet. */
export interface RecalledStatus {
  bridge?: GatewayStatus;
  service?: GatewayStatus;
  /** The kind of gateway the service status was heard from (its topic names it). */
  serviceKind?: GatewayKind;
  /** When the status last changed. */
  at?: Date;
}

export interface GatewayStatusMemory {
  recall(id: string): RecalledStatus | undefined;
}

export const GATEWAY_STATUS_MEMORY = Symbol('GATEWAY_STATUS_MEMORY');

/** `bridge`: the gateway's broker connection; `service`: its software behind it. */
export type GatewayStatusKind = 'bridge' | 'service';

export const STATUS_MEMORY_LIMIT = 1000;

/**
 * The last status heard for each gateway ID, registered or not. At most `limit` IDs are kept; the
 * one that was silent longest is forgotten first.
 */
export class StatusMemory implements GatewayStatusMemory {
  private readonly entries = new Map<string, RecalledStatus>();

  constructor(private readonly limit = STATUS_MEMORY_LIMIT) {}

  /** Stores the status; `true` if it differs from the one remembered before. */
  record(
    id: string,
    kind: GatewayStatusKind,
    status: GatewayStatus,
    now: Date,
    serviceKind?: GatewayKind,
  ): boolean {
    const entry = this.entries.get(id) ?? {};
    // A service status of another kind of gateway is a different status, even if the words match.
    const changed =
      entry[kind] !== status || (kind === 'service' && entry.serviceKind !== serviceKind);
    entry[kind] = status;
    if (kind === 'service') {
      if (serviceKind === undefined) delete entry.serviceKind;
      else entry.serviceKind = serviceKind;
    }
    if (changed) entry.at = now;
    this.entries.delete(id);
    this.entries.set(id, entry);
    if (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    return changed;
  }

  recall(id: string): RecalledStatus | undefined {
    const entry = this.entries.get(id);
    return entry && { ...entry };
  }
}

/** The default: nothing is remembered (the module provides the `StatusMemory` of the MQTT status consumer instead). */
export const noStatusMemory: GatewayStatusMemory = { recall: () => undefined };
