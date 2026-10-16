import { marker } from '@jsverse/transloco-keys-manager/marker';
import { primaryCapability, type Capability, type Device, type DeviceKind } from '@smart/contracts';
import type { UiToneName } from '@smart/ui';
import type { IconName } from '@smart/ui/shell';
import { binaryOf, formatNumber, formatReading, isBatteryLow } from './device-values';

// Root keys (marked, so the key check finds them): the words are translated where the pod is shown.
const WORDS = {
  on: marker('app.devices.pod.on'),
  off: marker('app.devices.pod.off'),
  dry: marker('app.devices.pod.dry'),
  wet: marker('app.devices.pod.wet'),
  ok: marker('app.devices.pod.ok'),
  offline: marker('app.devices.pod.offline'),
  lowBattery: marker('app.devices.pod.lowBattery'),
} as const;

/** A word in the pod's corner: a translation key and the colour family of its container. */
export interface PodChip {
  readonly key: string;
  readonly tone: UiToneName;
}

/** What `ui-device-pod` shows for one device; words come as keys, the template translates them. */
export interface PodModel extends ReadingValue {
  readonly kind: DeviceKind;
  readonly icon: IconName;
  /** "Name · side value". */
  readonly label: string;
  readonly chip: PodChip | null;
  readonly route: string;
}

/** The icon of a device's kind (pods, and the preview of new hardware). */
export const ICONS: Record<DeviceKind, IconName> = {
  light: 'lightbulb',
  soil: 'potted_plant',
  climate: 'thermostat',
  contact: 'door_open',
  other: 'sensors',
};

/** The reading that goes next to the name, when it is not the value itself. */
const SIDE_KEYS = ['temperature', 'humidity'] as const;

/** The word in the corner of a device's pod and of its hero: what is wrong, or "OK". */
export function chipOf(device: Device): PodChip | null {
  if (device.availability === 'offline') return { key: WORDS.offline, tone: 'error' };
  const { state, effectiveThresholds: limits } = device;
  const moisture = typeof state['soil_moisture'] === 'number' ? state['soil_moisture'] : undefined;
  // The sensor's own "dry" flag fires at its level, not the user's: it only counts while the
  // device reports no moisture number (the same rule as the backend's attention items).
  const dry =
    moisture === undefined
      ? binaryOf(state['dry']) === true
      : limits.soilMoistureMin !== null && moisture < limits.soilMoistureMin;
  if (dry) {
    return { key: WORDS.dry, tone: 'dry' };
  }
  if (
    moisture !== undefined &&
    limits.soilMoistureMax !== null &&
    moisture > limits.soilMoistureMax
  ) {
    return { key: WORDS.wet, tone: 'wet' };
  }
  if (isBatteryLow(device)) return { key: WORDS.lowBattery, tone: 'warning' };
  // "OK" needs a reading of the soil; while there is none, there is nothing to say yet.
  const reported = moisture !== undefined || binaryOf(state['dry']) !== undefined;
  return device.kind === 'soil' && reported ? { key: WORDS.ok, tone: 'ok' } : null;
}

/** A reading as a pod or the hero shows it: a number with its unit, or a word (`valueKey`). */
export interface ReadingValue {
  /** The value as it is shown, or `''` when `valueKey` is a word. */
  readonly value: string;
  /** A word as the value ("An", "trocken"); wins over `value`. */
  readonly valueKey?: string;
  readonly unit?: string;
}

/** A dash for a value that is not there yet. */
export const NO_VALUE = '–';

/** The value of one reading for a pod or the hero; no reading, or none yet, is a dash. */
export function readingValue(
  capability: Capability | undefined,
  raw: unknown,
  locale: string,
): ReadingValue {
  if (capability?.kind === 'numeric' && typeof raw === 'number' && Number.isFinite(raw)) {
    return {
      value: formatNumber(raw, locale),
      ...(capability.unit !== null && { unit: capability.unit }),
    };
  }
  if (capability?.kind === 'binary') {
    const on = binaryOf(raw);
    if (on !== undefined) {
      const word =
        capability.key === 'dry' ? (on ? WORDS.dry : WORDS.ok) : on ? WORDS.on : WORDS.off;
      return { value: '', valueKey: word };
    }
  }
  if ((capability?.kind === 'enum' || capability?.kind === 'text') && typeof raw === 'string') {
    return raw === '' ? { value: NO_VALUE } : { value: raw };
  }
  return { value: NO_VALUE };
}

/**
 * The pod of one device: the server's kind picks colour and icon, the first reading (soil
 * moisture, temperature, ...) is the value, and the chip says in words what is wrong, or "OK".
 */
export function podOf(device: Device, locale: string): PodModel {
  const main = primaryCapability(device.capabilities);
  const reading = readingValue(main, main ? device.state[main.key] : undefined, locale);
  const side = SIDE_KEYS.filter((key) => key !== main?.key)
    .map((key) => device.capabilities.find((capability) => capability.key === key))
    .find((capability) => capability !== undefined);
  const sideReading = side ? formatReading(side, device.state[side.key], locale) : undefined;
  return {
    kind: device.kind,
    icon: ICONS[device.kind],
    ...reading,
    label: sideReading?.kind === 'text' ? `${device.name} · ${sideReading.text}` : device.name,
    chip: chipOf(device),
    route: `/geraete/${device.id}`,
  };
}
