import type { AdapterEvent, ReportedHardware } from '../../core/adapters/index.js';
import { capabilitiesOf, sortedEntities } from './entities.js';
import { isObject, parseJson } from './json.js';
import { haDeviceSchema, haDevicesSchema, type HaDevice } from './protocol.js';

const present = (text: string | null): string | undefined => (text ? text : undefined);

/** The device's name, else its first entity's (by `entity_id`), else its model, else its id. */
function nameOf(device: HaDevice): string {
  const entityName = sortedEntities(device)[0]?.name;
  return present(device.name) ?? present(entityName ?? null) ?? present(device.model) ?? device.id;
}

function toHardware(device: HaDevice, raw: Record<string, unknown>): ReportedHardware {
  return {
    externalId: device.id,
    address: device.id,
    name: nameOf(device),
    vendor: device.manufacturer ?? '',
    model: device.model ?? '',
    description: null,
    setupState: 'ready',
    // As reported, so that capabilities can be derived again later.
    native: raw,
    capabilities: capabilitiesOf(device),
  };
}

/**
 * `devices`: the full list of the gateway's devices (unlisted ones count as removed). A malformed
 * entry is left out; a list of nothing but malformed entries is no list and reports nothing.
 */
export function translateDevices(payload: Buffer): AdapterEvent[] {
  const parsed = haDevicesSchema.safeParse(parseJson(payload));
  if (!parsed.success) return [];
  const hardware: ReportedHardware[] = [];
  for (const raw of parsed.data.devices) {
    const device = haDeviceSchema.safeParse(raw);
    if (device.success && isObject(raw)) hardware.push(toHardware(device.data, raw));
  }
  // A list of nothing but garbage must not mark all hardware as removed.
  if (hardware.length === 0 && parsed.data.devices.length > 0) return [];
  return [{ type: 'hardware.listed', hardware }];
}
