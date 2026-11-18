import { Injectable } from '@nestjs/common';
import type { Availability, GatewayStatus } from '@smart/contracts';
import type {
  AdapterEvent,
  AdapterMessage,
  DecodedReport,
  GatewayAdapter,
  StoredCapability,
} from '../../core/adapters/index.js';
import { translateDevices, translateEvent } from './bridge.js';
import { decodeZ2mReport } from './decode.js';
import { isObject, parseJson } from './json.js';
import { isBridgeTopic, isCommandTopic } from './z2m-topics.js';

/** A gateway with a hundred devices lists about a megabyte. */
const MAX_DEVICES_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_AVAILABILITY_BYTES = 1024;
/** A status payload is a few bytes; anything bigger is not one. */
const MAX_STATE_BYTES = 1024;
const AVAILABILITY_SUFFIX = '/availability';

/** Reads `online`/`offline` as text or as JSON `{"state":"…"}`; anything else is neither. */
function parseOnline(payload: Buffer): 'online' | 'offline' | undefined {
  const text = payload.toString('utf8').trim();
  if (text === 'online' || text === 'offline') return text;
  if (!text.startsWith('{')) return undefined;
  const json = parseJson(payload);
  const state = isObject(json) ? json.state : undefined;
  return state === 'online' || state === 'offline' ? state : undefined;
}

/**
 * Zigbee2MQTT below `gw/<id>/z2m/`: devices are addressed by their `friendly_name`, the bridge
 * lists them and reports joins, interviews, leaves and renames. Payloads are never logged.
 */
@Injectable()
export class Z2mAdapter implements GatewayAdapter {
  readonly kind = 'z2m';
  readonly serviceStatusTopic = 'bridge/state';

  parseServiceStatus(payload: Buffer): GatewayStatus | undefined {
    if (payload.length > MAX_STATE_BYTES) return undefined;
    return parseOnline(payload);
  }

  classify(topic: string): { maxBytes: number } | undefined {
    if (topic === 'bridge/devices') return { maxBytes: MAX_DEVICES_BYTES };
    if (topic === 'bridge/event') return { maxBytes: MAX_MESSAGE_BYTES };
    if (isBridgeTopic(topic) || isCommandTopic(topic)) return undefined;
    // A device without a name is none: the core could not address it.
    if (topic.endsWith(AVAILABILITY_SUFFIX)) {
      return topic.length > AVAILABILITY_SUFFIX.length
        ? { maxBytes: MAX_AVAILABILITY_BYTES }
        : undefined;
    }
    return topic === '' ? undefined : { maxBytes: MAX_MESSAGE_BYTES };
  }

  translate({ topic, payload }: AdapterMessage): AdapterEvent[] {
    if (topic === 'bridge/devices') return translateDevices(payload);
    if (topic === 'bridge/event') return translateEvent(payload);
    if (this.classify(topic) === undefined) return [];
    // Every device message is a sign of life, also one for a name the core does not know.
    if (topic.endsWith(AVAILABILITY_SUFFIX)) {
      const address = topic.slice(0, -AVAILABILITY_SUFFIX.length);
      const availability: Availability | undefined = parseOnline(payload);
      return availability === undefined
        ? [{ type: 'activity' }]
        : [{ type: 'hardware.availability', ref: { address }, availability }, { type: 'activity' }];
    }
    const native = parseJson(payload);
    return isObject(native)
      ? [{ type: 'hardware.report', ref: { address: topic }, native }, { type: 'activity' }]
      : [{ type: 'activity' }];
  }

  decodeReport(native: unknown, capabilities: readonly StoredCapability[]): DecodedReport {
    return decodeZ2mReport(native, capabilities);
  }
}
