import { Injectable } from '@nestjs/common';
import type { GatewayStatus } from '@smart/contracts';
import type {
  AdapterEvent,
  AdapterMessage,
  DecodedReport,
  GatewayAdapter,
  StoredCapability,
} from '../../core/adapters/index.js';
import { availabilityOf, decodeHaReport } from './decode.js';
import { translateDevices } from './devices.js';
import { parseJson } from './json.js';
import { DEVICE_ID_PATTERN, haSnapshotSchema } from './protocol.js';

/** A gateway with a hundred devices lists about a megabyte. */
const MAX_DEVICES_BYTES = 4 * 1024 * 1024;
/** The integration publishes no snapshot above 60 KiB. */
const MAX_SNAPSHOT_BYTES = 64 * 1024;
/** A status payload is a few bytes; anything bigger is not one. */
const MAX_STATE_BYTES = 1024;
const DEVICE_PREFIX = 'device/';

/** The device id of a `device/<id>` topic, if it is one. */
const deviceIdOf = (topic: string): string | undefined => {
  if (!topic.startsWith(DEVICE_PREFIX)) return undefined;
  const id = topic.slice(DEVICE_PREFIX.length);
  return DEVICE_ID_PATTERN.test(id) ? id : undefined;
};

/**
 * Home Assistant below `gw/<id>/ha/`: the `smart_bridge` integration lists the devices on
 * `devices` and publishes the state of each one's entities on `device/<id>`. Payloads are never logged.
 */
@Injectable()
export class HaAdapter implements GatewayAdapter {
  readonly kind = 'ha';
  readonly serviceStatusTopic = 'status';

  parseServiceStatus(payload: Buffer): GatewayStatus | undefined {
    if (payload.length > MAX_STATE_BYTES) return undefined;
    const text = payload.toString('utf8').trim();
    return text === 'online' || text === 'offline' ? text : undefined;
  }

  classify(topic: string): { maxBytes: number } | undefined {
    if (topic === 'devices') return { maxBytes: MAX_DEVICES_BYTES };
    return deviceIdOf(topic) === undefined ? undefined : { maxBytes: MAX_SNAPSHOT_BYTES };
  }

  translate({ topic, payload }: AdapterMessage): AdapterEvent[] {
    if (topic === 'devices') return translateDevices(payload);
    const id = deviceIdOf(topic);
    // An empty retained message clears a device that was removed: nothing to report.
    if (id === undefined || payload.length === 0) return [];
    // Every device message is a sign of life, also one that is of no use.
    const native = parseJson(payload);
    if (!haSnapshotSchema.safeParse(native).success) return [{ type: 'activity' }];
    const events: AdapterEvent[] = [{ type: 'hardware.report', ref: { address: id }, native }];
    const availability = availabilityOf(native);
    if (availability !== undefined) {
      events.push({ type: 'hardware.availability', ref: { address: id }, availability });
    }
    events.push({ type: 'activity' });
    return events;
  }

  decodeReport(native: unknown, capabilities: readonly StoredCapability[]): DecodedReport {
    return decodeHaReport(native, capabilities);
  }
}
