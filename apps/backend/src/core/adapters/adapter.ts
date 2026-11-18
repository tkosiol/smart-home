import type { Availability, Capability, GatewayKind, GatewayStatus } from '@smart/contracts';

/** One gateway kind, e.g. Zigbee2MQTT. Stateless: everything it needs comes in the arguments. */
export interface GatewayAdapter {
  readonly kind: GatewayKind;

  /** Topic below `gw/<id>/<kind>/` that carries the status of the gateway's service (may be retained). */
  readonly serviceStatusTopic: string;
  parseServiceStatus(payload: Buffer): GatewayStatus | undefined;

  /**
   * Whether a topic below the prefix is of use, and how big its payload may be. Decided before the
   * message is queued; `undefined` drops it without counting.
   */
  classify(topic: string): { maxBytes: number } | undefined;

  /** Turns one message into neutral events (none if it is of no use). Must not throw for bad input. */
  translate(message: AdapterMessage): AdapterEvent[];

  /** Turns the native fields of a report into canonical values, using what was stored at listing. */
  decodeReport(native: unknown, capabilities: readonly StoredCapability[]): DecodedReport;
}

export interface AdapterMessage {
  gatewayId: string;
  topic: string; // below the prefix, e.g. `Monstera` or `bridge/devices`
  payload: Buffer;
}

export type HardwareRef = { externalId: string } | { address: string };

export type AdapterEvent =
  /** The full list of the gateway's hardware: unlisted hardware counts as removed. */
  | { type: 'hardware.listed'; hardware: ReportedHardware[] }
  /** One piece of hardware joined or changed; others stay as they are. */
  | { type: 'hardware.joined'; externalId: string; address: string | null; name: string }
  | { type: 'hardware.setup'; externalId: string; setupState: SetupState }
  | { type: 'hardware.left'; externalId: string }
  /** The adapter's address changed (Z2M rename); `name` is the new name in the foreign system. */
  | { type: 'hardware.readdressed'; from: string; to: string; name: string }
  | { type: 'hardware.availability'; ref: HardwareRef; availability: Availability }
  /** A report of the hardware's state; `native` is decoded by `decodeReport` once the hardware is known. */
  | { type: 'hardware.report'; ref: HardwareRef; native: unknown }
  /** The gateway is alive (device traffic, not its own status or a command). */
  | { type: 'activity' };

export interface ReportedHardware {
  externalId: string;
  address: string | null;
  name: string;
  vendor: string;
  model: string;
  description: string | null;
  setupState: SetupState;
  /** Kept as reported for diagnosis and re-derivation; never sent to clients. */
  native: Record<string, unknown>;
  capabilities: ReportedCapability[];
}

/** A capability as stored: the neutral fields plus what only the adapter reads. */
export interface ReportedCapability extends Capability {
  native: Record<string, unknown>;
}
export type StoredCapability = ReportedCapability;

export interface DecodedReport {
  /** Canonical keys → values in the vocabulary's units; booleans for binary capabilities. */
  values: Record<string, unknown>;
  /** When the hardware measured, if it says so; the core checks plausibility. */
  measuredAt: Date | undefined;
}

export const SETUP_STATES = ['pairing', 'ready', 'failed', 'unknown'] as const;
export type SetupState = (typeof SETUP_STATES)[number];
