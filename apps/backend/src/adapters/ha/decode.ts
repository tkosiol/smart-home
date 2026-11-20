import { vocabularyEntry } from '@smart/contracts';
import type { Availability } from '@smart/contracts';
import type { DecodedReport, StoredCapability } from '../../core/adapters/index.js';
import { TEMPERATURE_UNITS } from './entities.js';
import { isObject } from './json.js';
import { entityStates, type HaEntityState } from './protocol.js';

const MAX_BRIGHTNESS = 255;
const KELVIN_OFFSET = 273.15;
/** Only ISO 8601 with an explicit offset or Z; anything else (no offset, epoch numbers) is not trusted. */
const ZONED_ISO = /(Z|[+-]\d{2}:\d{2})$/;
/** States that say the entity has no value (right now). */
const NO_VALUE = new Set(['unavailable', 'unknown']);

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Turns a snapshot of a device's entities into canonical values by what was stored at listing. A
 * value that does not fit is handed on unchanged only where the core can judge it; what means
 * nothing (an unavailable entity, a lamp that is off) is left out.
 */
export function decodeHaReport(
  native: unknown,
  capabilities: readonly StoredCapability[],
): DecodedReport {
  const states = entityStates(native);
  const values: Record<string, unknown> = {};
  for (const capability of capabilities) {
    // Stored rows come from the database: a broken one is skipped, not a reason to throw.
    if (!isObject(capability.native)) continue;
    const { entity, source, unit } = capability.native;
    if (typeof entity !== 'string' || typeof source !== 'string') continue;
    const state = states.get(entity);
    if (state?.state === undefined || NO_VALUE.has(state.state)) continue;
    const value = decodeValue(source, unit, state);
    if (value !== undefined) values[capability.key] = value;
  }
  return { values, measuredAt: latestUpdate(states.values()) };
}

function decodeValue(source: string, unit: unknown, entity: HaEntityState): unknown {
  switch (source) {
    case 'onoff':
      return entity.state === 'on' ? true : entity.state === 'off' ? false : undefined;
    case 'closed':
      // A door sensor is `on` when open; the vocabulary's contact is true when closed.
      return entity.state === 'off' ? true : entity.state === 'on' ? false : undefined;
    case 'brightness': {
      const raw = entity.attributes?.brightness;
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
      const percent = Math.round((raw / MAX_BRIGHTNESS) * 100);
      // 1–2 of 255 would round to 0: a lamp that is on must not read as off.
      return raw > 0 ? Math.max(percent, 1) : percent;
    }
    case 'kelvin': {
      const raw = entity.attributes?.color_temp_kelvin;
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
      const { min, max } = vocabularyEntry('color_temp');
      return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.round(raw)));
    }
    case 'numeric': {
      const shown = readingUnit(unit, entity);
      return shown === undefined ? undefined : decodeNumeric(entity.state, shown);
    }
    default:
      return undefined;
  }
}

/**
 * The unit the state is in. A user may pick another display unit in HA after the listing; only the
 * state's `unit_of_measurement` says so, the registry keeps the old one. A unit that does not fit
 * the capability (anything but °C/°F/K for a temperature, anything else than the listed unit
 * otherwise) gives no reading rather than a wrong one. Without the attribute the listed unit applies.
 */
function readingUnit(listed: unknown, entity: HaEntityState): unknown {
  const shown = entity.attributes?.unit_of_measurement;
  if (typeof shown !== 'string') return listed;
  const fits =
    typeof listed === 'string' && TEMPERATURE_UNITS.has(listed)
      ? TEMPERATURE_UNITS.has(shown)
      : shown === listed;
  return fits ? shown : undefined;
}

function decodeNumeric(state: string | undefined, unit: unknown): number | undefined {
  // `Number('')` is 0: an empty state is no reading.
  if (state === undefined || state.trim() === '') return undefined;
  const value = Number(state);
  if (!Number.isFinite(value)) return undefined;
  if (unit === '°F') return round2(((value - 32) * 5) / 9);
  if (unit === 'K') return round2(value - KELVIN_OFFSET);
  return value;
}

/** The most recent valid `last_updated`; the core decides whether that is plausible. */
function latestUpdate(states: Iterable<HaEntityState>): Date | undefined {
  let latest: Date | undefined;
  for (const { last_updated: updated } of states) {
    if (updated === undefined || !ZONED_ISO.test(updated)) continue;
    const time = new Date(updated);
    if (!Number.isNaN(time.getTime()) && (latest === undefined || time > latest)) latest = time;
  }
  return latest;
}

/**
 * Whether a device is reachable: HA reports every entity of an unplugged lamp as `unavailable`.
 * A snapshot without entities says nothing.
 */
export function availabilityOf(snapshot: unknown): Availability | undefined {
  const states = [...entityStates(snapshot).values()];
  if (states.length === 0) return undefined;
  return states.every((entity) => entity.state === 'unavailable') ? 'offline' : 'online';
}
