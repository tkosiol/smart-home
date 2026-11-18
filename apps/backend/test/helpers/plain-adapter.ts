import type { Availability, GatewayStatus } from '@smart/contracts';
import type {
  AdapterEvent,
  AdapterMessage,
  DecodedReport,
  GatewayAdapter,
  ReportedCapability,
} from '../../src/core/adapters/index.js';

interface PlainCapability {
  key: string;
  kind: ReportedCapability['kind'];
  unit: string | null;
  read: boolean;
  write: boolean;
}
interface PlainNode {
  id: string;
  title: string;
  caps: PlainCapability[];
}

const NODE = /^node\/([^/]+)(\/reach)?$/;

const parseJson = (payload: Buffer): unknown => {
  try {
    return JSON.parse(payload.toString('utf8'));
  } catch {
    return undefined;
  }
};

/**
 * A made-up gateway software with nothing in common with Zigbee2MQTT: its own topics, its own
 * payloads, canonical values already. It is registered under the kind `z2m` only because the
 * database knows no other kind; it proves that the core depends on the adapter contract alone.
 */
export class PlainAdapter implements GatewayAdapter {
  readonly kind = 'z2m' as const;
  readonly serviceStatusTopic = 'service';

  parseServiceStatus(payload: Buffer): GatewayStatus | undefined {
    const text = payload.toString('utf8');
    if (text === 'up') return 'online';
    if (text === 'down') return 'offline';
    return undefined;
  }

  classify(topic: string): { maxBytes: number } | undefined {
    return topic === 'inventory' || NODE.test(topic) ? { maxBytes: 65_536 } : undefined;
  }

  translate({ topic, payload }: AdapterMessage): AdapterEvent[] {
    if (topic === 'inventory') {
      const nodes = parseJson(payload);
      if (!Array.isArray(nodes)) return [];
      return [
        {
          type: 'hardware.listed',
          hardware: (nodes as PlainNode[]).map((node) => ({
            externalId: node.id,
            address: null,
            name: node.title,
            vendor: 'Plain',
            model: 'P-1',
            description: null,
            setupState: 'ready' as const,
            native: {},
            capabilities: node.caps.map((cap) => ({
              key: cap.key,
              kind: cap.kind,
              unit: cap.unit,
              min: null,
              max: null,
              step: null,
              enumValues: null,
              readable: cap.read,
              writable: cap.write,
              isSetting: false,
              native: {},
            })),
          })),
        },
      ];
    }
    const match = NODE.exec(topic);
    const id = match?.[1];
    if (!id) return [];
    if (match[2]) {
      const text = payload.toString('utf8');
      const availability: Availability | undefined =
        text === 'yes' ? 'online' : text === 'no' ? 'offline' : undefined;
      return availability
        ? [{ type: 'hardware.availability', ref: { externalId: id }, availability }]
        : [];
    }
    const values = parseJson(payload);
    if (typeof values !== 'object' || values === null || Array.isArray(values)) return [];
    return [
      { type: 'hardware.report', ref: { externalId: id }, native: values },
      { type: 'activity' },
    ];
  }

  decodeReport(native: unknown): DecodedReport {
    const isObject = typeof native === 'object' && native !== null && !Array.isArray(native);
    return { values: isObject ? (native as Record<string, unknown>) : {}, measuredAt: undefined };
  }
}
