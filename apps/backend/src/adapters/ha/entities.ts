import { vocabularyEntry, type CanonicalKey } from '@smart/contracts';
import type { ReportedCapability } from '../../core/adapters/index.js';
import type { HaDevice, HaEntity } from './protocol.js';

/** How an entity's state is turned into the vocabulary's value (read back by `decode.ts`). */
export type HaSource = 'onoff' | 'brightness' | 'kelvin' | 'numeric' | 'closed';

/** The units a temperature may come in (`decode.ts` converts them to °C). */
export const TEMPERATURE_UNITS: ReadonlySet<string> = new Set(['°C', '°F', 'K']);
const DOOR_CLASSES = new Set(['door', 'window', 'opening', 'garage_door']);
/** Sensors by `device_class`: the vocabulary key and the units the registry may report. */
const SENSORS: Record<string, { key: CanonicalKey; units: ReadonlySet<string> }> = {
  temperature: { key: 'temperature', units: TEMPERATURE_UNITS },
  humidity: { key: 'humidity', units: new Set(['%']) },
  moisture: { key: 'soil_moisture', units: new Set(['%']) },
  battery: { key: 'battery', units: new Set(['%']) },
};

/** A device's entities in the order the capabilities (and a name) are derived in. */
export const sortedEntities = (device: HaDevice): HaEntity[] =>
  [...device.entities].sort((a, b) =>
    a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0,
  );

function capability(
  key: CanonicalKey,
  entity: string,
  source: HaSource,
  options: {
    writable?: boolean;
    min?: number | null;
    max?: number | null;
    step?: number | null;
    unit?: string;
  } = {},
): ReportedCapability {
  const entry = vocabularyEntry(key);
  return {
    key,
    kind: entry.kind,
    unit: entry.unit,
    min: options.min ?? entry.min,
    max: options.max ?? entry.max,
    step: options.step ?? null,
    enumValues: null,
    readable: true,
    writable: options.writable ?? false,
    // A control is switched by people, a reading is not settable: neither is a setting of the device.
    isSetting: false,
    native: { entity, source, ...(options.unit === undefined ? {} : { unit: options.unit }) },
  };
}

/** The range a lamp says it covers, narrowed to the vocabulary's (an adapter never widens it). */
function kelvinRange(capabilities: HaEntity['capabilities']): { min: number; max: number } {
  const entry = vocabularyEntry('color_temp');
  const vocabulary = { min: entry.min ?? 0, max: entry.max ?? Infinity };
  const read = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(vocabulary.max, Math.max(vocabulary.min, Math.round(value)))
      : undefined;
  const min = read(capabilities?.min_color_temp_kelvin) ?? vocabulary.min;
  const max = read(capabilities?.max_color_temp_kelvin) ?? vocabulary.max;
  return min <= max ? { min, max } : vocabulary;
}

function colorModes(entity: HaEntity): string[] {
  const modes = entity.capabilities?.supported_color_modes;
  return Array.isArray(modes)
    ? modes.filter((mode): mode is string => typeof mode === 'string')
    : [];
}

/** The capabilities one entity stands for, keyed by the vocabulary (before collisions are resolved). */
function capabilitiesOfEntity(entity: HaEntity): ReportedCapability[] {
  const id = entity.entity_id;
  switch (entity.domain) {
    case 'light': {
      const modes = colorModes(entity);
      const out = [capability('state', id, 'onoff', { writable: true })];
      if (modes.some((mode) => mode !== 'onoff')) {
        out.push(capability('brightness', id, 'brightness', { writable: true, step: 1 }));
      }
      if (modes.includes('color_temp')) {
        out.push(
          capability('color_temp', id, 'kelvin', {
            writable: true,
            ...kelvinRange(entity.capabilities),
          }),
        );
      }
      return out;
    }
    case 'switch':
      return [capability('state', id, 'onoff', { writable: true })];
    case 'sensor': {
      const sensor = SENSORS[entity.device_class ?? ''];
      // An unknown unit would give wrong numbers: better none than a wrong temperature.
      if (!sensor || entity.unit === null || !sensor.units.has(entity.unit)) return [];
      return [capability(sensor.key, id, 'numeric', { unit: entity.unit })];
    }
    case 'binary_sensor':
      return DOOR_CLASSES.has(entity.device_class ?? '')
        ? [capability('contact', id, 'closed')]
        : [];
    default:
      // Unlike Zigbee2MQTT nothing is passed through: entity names are free text and would only be noise.
      return [];
  }
}

/**
 * The capabilities of a device, entity by entity in `entity_id` order. A key that is taken gets
 * `_2`, `_3`, … (a second temperature sensor), so no entity costs another its capability.
 */
export function capabilitiesOf(device: HaDevice): ReportedCapability[] {
  const taken = new Set<string>();
  return sortedEntities(device)
    .flatMap(capabilitiesOfEntity)
    .map((found) => {
      let key: string = found.key;
      for (let n = 2; taken.has(key); n += 1) key = `${found.key}_${n}`;
      taken.add(key);
      return { ...found, key };
    });
}
