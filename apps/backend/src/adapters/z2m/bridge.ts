import * as z from 'zod';
import type { AdapterEvent, ReportedHardware, SetupState } from '../../core/adapters/index.js';
import { capabilitiesFromExposes, exposesSchema } from './exposes.js';
import { isObject, parseJson } from './json.js';

const IEEE_ADDRESS = /^0x[0-9a-f]{16}$/i;

const ieeeAddress = z.string().regex(IEEE_ADDRESS);
const friendlyName = z.string().min(1).max(255);

const bridgeDeviceSchema = z.object({
  ieee_address: ieeeAddress,
  friendly_name: friendlyName,
  type: z.string().optional().catch(undefined),
  interview_state: z.string().optional().catch(undefined),
  manufacturer: z.string().optional().catch(undefined),
  model_id: z.string().optional().catch(undefined),
  definition: z.unknown().optional(),
});
/** The entries are parsed one by one: a malformed one must not cost the others. */
const bridgeDevicesSchema = z.array(z.unknown());
const definitionInfoSchema = z.object({
  vendor: z.string().optional().catch(undefined),
  model: z.string().optional().catch(undefined),
  description: z.string().optional().catch(undefined),
  exposes: exposesSchema.catch([]),
});

const bridgeEventSchema = z.object({ type: z.string(), data: z.unknown().optional() });
const joinedSchema = z.object({ ieee_address: ieeeAddress, friendly_name: friendlyName });
const interviewSchema = z.object({
  ieee_address: ieeeAddress,
  status: z.enum(['started', 'successful', 'failed']),
});
const leaveSchema = z.object({ ieee_address: ieeeAddress });
const renamedSchema = z.object({ from: friendlyName, to: friendlyName });

/** Z2M's `interview_state` of a listed device; anything else is `unknown`. */
const SETUP_BY_INTERVIEW_STATE: Record<string, SetupState> = {
  SUCCESSFUL: 'ready',
  FAILED: 'failed',
  PENDING: 'pairing',
  IN_PROGRESS: 'pairing',
};
/** The `status` of a `device_interview` event. */
const SETUP_BY_INTERVIEW_STATUS = {
  started: 'pairing',
  successful: 'ready',
  failed: 'failed',
} as const satisfies Record<string, SetupState>;

/** One entry of `bridge/devices` as neutral hardware. */
function toHardware(entry: z.infer<typeof bridgeDeviceSchema>): ReportedHardware {
  const info = definitionInfoSchema.safeParse(entry.definition);
  const definition = info.success ? info.data : undefined;
  return {
    externalId: entry.ieee_address,
    address: entry.friendly_name,
    name: entry.friendly_name,
    vendor: definition?.vendor ?? entry.manufacturer ?? '',
    model: definition?.model ?? entry.model_id ?? '',
    description: definition?.description ?? null,
    setupState: SETUP_BY_INTERVIEW_STATE[entry.interview_state ?? ''] ?? 'unknown',
    // As reported; a device Z2M does not support has none.
    native: isObject(entry.definition) ? entry.definition : {},
    capabilities: capabilitiesFromExposes(definition?.exposes ?? []),
  };
}

/**
 * `bridge/devices`: the full list of the gateway's devices (unlisted ones count as removed). A
 * malformed entry is left out; a list of nothing but malformed entries is no list and reports nothing.
 */
export function translateDevices(payload: Buffer): AdapterEvent[] {
  const parsed = bridgeDevicesSchema.safeParse(parseJson(payload));
  if (!parsed.success) return [];
  const hardware: ReportedHardware[] = [];
  let valid = 0;
  for (const raw of parsed.data) {
    const entry = bridgeDeviceSchema.safeParse(raw);
    if (!entry.success) continue;
    valid += 1;
    if (entry.data.type !== 'Coordinator') hardware.push(toHardware(entry.data));
  }
  // A list of nothing but garbage must not mark all hardware as removed.
  if (valid === 0 && parsed.data.length > 0) return [];
  return [{ type: 'hardware.listed', hardware }];
}

/** `bridge/event`: a device joined, was interviewed, left or was renamed; others report nothing. */
export function translateEvent(payload: Buffer): AdapterEvent[] {
  const event = bridgeEventSchema.safeParse(parseJson(payload));
  if (!event.success) return [];
  const { type, data } = event.data;
  switch (type) {
    case 'device_joined': {
      const joined = joinedSchema.safeParse(data);
      if (!joined.success) return [];
      const { ieee_address: externalId, friendly_name: name } = joined.data;
      return [
        { type: 'hardware.joined', externalId, address: name, name },
        // Z2M interviews a device after it joined; the interview events follow.
        { type: 'hardware.setup', externalId, setupState: 'pairing' },
      ];
    }
    case 'device_interview': {
      const interview = interviewSchema.safeParse(data);
      if (!interview.success) return [];
      return [
        {
          type: 'hardware.setup',
          externalId: interview.data.ieee_address,
          setupState: SETUP_BY_INTERVIEW_STATUS[interview.data.status],
        },
      ];
    }
    case 'device_leave': {
      const left = leaveSchema.safeParse(data);
      return left.success ? [{ type: 'hardware.left', externalId: left.data.ieee_address }] : [];
    }
    case 'device_renamed': {
      const renamed = renamedSchema.safeParse(data);
      if (!renamed.success) return [];
      const { from, to } = renamed.data;
      return [{ type: 'hardware.readdressed', from, to, name: to }];
    }
    default:
      return [];
  }
}
