import type { DecodedReport, StoredCapability } from '../../core/adapters/index.js';
import { isObject } from './json.js';

const DEFAULT_BRIGHTNESS_MAX = 254;
const MIRED_PER_KELVIN = 1e6;
/** Only ISO 8601 with an explicit offset or Z; anything else (no offset, epoch numbers) is not trusted. */
const ZONED_ISO = /(Z|[+-]\d{2}:\d{2})$/;

/**
 * Turns a Z2M state message into canonical values by what was stored at listing. A value that does
 * not fit is handed on unchanged: checking it is the core's job, which counts and drops it.
 */
export function decodeZ2mReport(
  native: unknown,
  capabilities: readonly StoredCapability[],
): DecodedReport {
  if (!isObject(native)) return { values: {}, measuredAt: undefined };
  const values: Record<string, unknown> = {};
  for (const capability of capabilities) {
    // Stored rows come from the database: a broken one is skipped, not a reason to throw.
    if (!isObject(capability.native)) continue;
    const property = capability.native.property;
    if (typeof property !== 'string' || !Object.hasOwn(native, property)) continue;
    const value = decodeValue(capability, native[property]);
    if (value !== undefined) values[capability.key] = value;
  }
  return { values, measuredAt: measuredAt(native.last_seen) };
}

/** The canonical value; `undefined` when the raw value means nothing (a colour temperature of 0). */
function decodeValue(capability: StoredCapability, raw: unknown): unknown {
  const { key, kind, native } = capability;
  if (kind === 'binary') return decodeBinary(native, raw);
  if (key === 'brightness' && typeof raw === 'number') {
    const max =
      typeof native.max === 'number' && native.max > 0 ? native.max : DEFAULT_BRIGHTNESS_MAX;
    const percent = Math.round((raw / max) * 100);
    // Z2M 1–3 of 254 would round to 0: a lamp that is on must not read as off.
    return raw > 0 ? Math.max(percent, 1) : percent;
  }
  if (key === 'color_temp' && typeof raw === 'number') {
    return raw > 0 ? Math.round(MIRED_PER_KELVIN / raw) : undefined;
  }
  return raw;
}

function decodeBinary(native: Record<string, unknown>, raw: unknown): unknown {
  // A boolean already means on/off: Z2M's contact preset says value_on=false, yet true = closed.
  if (typeof raw === 'boolean') return raw;
  // Rows stored before the adapter kept the values have neither: Z2M's default then.
  const stored = Object.hasOwn(native, 'valueOn') || Object.hasOwn(native, 'valueOff');
  const on = stored ? native.valueOn : 'ON';
  const off = stored ? native.valueOff : 'OFF';
  if (raw === on) return true;
  if (raw === off) return false;
  return raw;
}

/** When the device says it measured; the core decides whether that is plausible. */
function measuredAt(lastSeen: unknown): Date | undefined {
  if (typeof lastSeen !== 'string' || !ZONED_ISO.test(lastSeen)) return undefined;
  const time = new Date(lastSeen);
  return Number.isNaN(time.getTime()) ? undefined : time;
}
