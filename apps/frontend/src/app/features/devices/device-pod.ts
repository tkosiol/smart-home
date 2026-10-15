import { marker } from '@jsverse/transloco-keys-manager/marker';
import { primaryCapability, type Device, type DeviceKind } from '@smart/contracts';
import type { UiToneName } from '@smart/ui';
import type { IconName } from '@smart/ui/shell';
import { binaryOf, formatNumber, formatReading } from './device-values';

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
export interface PodModel {
  readonly kind: DeviceKind;
  readonly icon: IconName;
  /** The value as it is shown, or `''` when `valueKey` is a word. */
  readonly value: string;
  /** A word as the value ("An", "trocken"); wins over `value`. */
  readonly valueKey?: string;
  readonly unit?: string;
  /** "Name · side value". */
  readonly label: string;
  readonly chip: PodChip | null;
  readonly route: string;
}

const ICONS: Record<DeviceKind, IconName> = {
  light: 'lightbulb',
  soil: 'potted_plant',
  climate: 'thermostat',
  contact: 'door_open',
  other: 'sensors',
};

/** The reading that goes next to the name, when it is not the value itself. */
const SIDE_KEYS = ['temperature', 'humidity'] as const;

/** A dash for a value that is not there yet. */
const NO_VALUE = '–';

function chipOf(device: Device): PodChip | null {
  if (device.availability === 'offline') return { key: WORDS.offline, tone: 'error' };
  const { state, effectiveThresholds: limits } = device;
  const moisture = typeof state['soil_moisture'] === 'number' ? state['soil_moisture'] : undefined;
  if (
    binaryOf(state['dry']) === true ||
    (moisture !== undefined && limits.soilMoistureMin !== null && moisture < limits.soilMoistureMin)
  ) {
    return { key: WORDS.dry, tone: 'dry' };
  }
  if (
    moisture !== undefined &&
    limits.soilMoistureMax !== null &&
    moisture > limits.soilMoistureMax
  ) {
    return { key: WORDS.wet, tone: 'wet' };
  }
  const battery = state['battery'];
  if (typeof battery === 'number' && battery < limits.batteryMin) {
    return { key: WORDS.lowBattery, tone: 'warning' };
  }
  return device.kind === 'soil' ? { key: WORDS.ok, tone: 'ok' } : null;
}

/**
 * The pod of one device: the server's kind picks colour and icon, the first reading (soil
 * moisture, temperature, ...) is the value, and the chip says in words what is wrong, or "OK".
 */
export function podOf(device: Device, locale: string): PodModel {
  const main = primaryCapability(device.capabilities);
  const raw = main ? device.state[main.key] : undefined;
  let value = NO_VALUE;
  let valueKey: string | undefined;
  let unit: string | undefined;
  if (main?.kind === 'numeric' && typeof raw === 'number' && Number.isFinite(raw)) {
    value = formatNumber(raw, locale);
    unit = main.unit ?? undefined;
  } else if (main?.kind === 'binary') {
    const on = binaryOf(raw);
    if (on !== undefined) {
      value = '';
      valueKey = main.key === 'dry' ? (on ? WORDS.dry : WORDS.ok) : on ? WORDS.on : WORDS.off;
    }
  }
  const side = SIDE_KEYS.filter((key) => key !== main?.key)
    .map((key) => device.capabilities.find((capability) => capability.key === key))
    .find((capability) => capability !== undefined);
  const sideReading = side ? formatReading(side, device.state[side.key], locale) : undefined;
  return {
    kind: device.kind,
    icon: ICONS[device.kind],
    value,
    ...(valueKey !== undefined && { valueKey }),
    ...(unit !== undefined && { unit }),
    label: sideReading?.kind === 'text' ? `${device.name} · ${sideReading.text}` : device.name,
    chip: chipOf(device),
    route: `/geraete/${device.id}`,
  };
}
