import {
  SEVERITY_OF,
  attentionListSchema,
  type AttentionItem,
  type AttentionKind,
} from '@smart/contracts';
import { json } from '../../testing/auth-testing';
import type { RecordedCall } from '../../testing/household-page-testing';

/** A notice as the server would send it; the test fixtures are checked against the contract. */
export function attentionItem(
  kind: AttentionKind,
  name: string,
  overrides: Partial<AttentionItem> = {},
): AttentionItem {
  const subject = overrides.id ?? `${kind}:${name}`;
  const item: AttentionItem = {
    id: subject,
    kind,
    severity: SEVERITY_OF[kind],
    since: '2026-10-14T11:00:00.000Z',
    name,
    params: {},
    ...(kind === 'gateway_offline' || kind === 'hardware_new' || kind === 'cert_expiring'
      ? { gatewayId: 'gw-aaaaaaaa' }
      : { deviceId: `dev-${name}`, gatewayId: 'gw-aaaaaaaa' }),
    ...overrides,
  };
  return attentionListSchema.parse({ items: [item] }).items[0]!;
}

/** The sample of review focus 1: a gateway offline and 19 plants and sensors in trouble. */
export function manyNotices(): AttentionItem[] {
  return [
    attentionItem('gateway_offline', 'Pi', { params: { affectedDevices: 18 } }),
    ...Array.from({ length: 12 }, (_, i) =>
      attentionItem('soil_dry', `Pflanze ${i + 1}`, { value: 20, unit: '%' }),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      attentionItem('battery_low', `Sensor ${i + 1}`, { value: 9, unit: '%' }),
    ),
    ...Array.from({ length: 3 }, (_, i) => attentionItem('contact_open', `Fenster ${i + 1}`)),
  ];
}

/** The part of a device that the calm row reads. */
export interface ReportingDevice {
  readonly id: string;
  readonly lastSeenAt: string | null;
}
export const reportingDevice = (id: string, lastSeenAt: string | null): ReportingDevice => ({
  id,
  lastSeenAt,
});

/** A stand-in for `GET …/attention` and `GET …/devices` of one household. */
export function attentionServer(
  householdId: string,
  initial: { items?: AttentionItem[]; devices?: ReportingDevice[] } = {},
) {
  const state = { items: initial.items ?? [], devices: initial.devices ?? [] };
  const base = `/api/v1/households/${householdId}`;
  const respond = (call: RecordedCall): Response => {
    const path = call.path.replace(base, '');
    if (call.method === 'GET' && path === '/attention') return json({ items: state.items });
    if (call.method === 'GET' && path === '/devices') return json(state.devices);
    return new Response(null, { status: 204 });
  };
  return { state, respond };
}
