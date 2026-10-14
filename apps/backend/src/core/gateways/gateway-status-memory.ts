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

export type GatewayStatusKind = 'bridge' | 'z2m';

export const STATUS_MEMORY_LIMIT = 1000;

/**
 * The last status heard for each gateway ID, registered or not. At most `limit` IDs are kept; the
 * one that was silent longest is forgotten first.
 */
export class StatusMemory implements GatewayStatusMemory {
  private readonly entries = new Map<string, RecalledStatus>();

  constructor(private readonly limit = STATUS_MEMORY_LIMIT) {}

  /** Stores the status; `true` if it differs from the one remembered before. */
  record(id: string, kind: GatewayStatusKind, status: GatewayStatus, now: Date): boolean {
    const entry = this.entries.get(id) ?? {};
    const changed = entry[kind] !== status;
    entry[kind] = status;
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
