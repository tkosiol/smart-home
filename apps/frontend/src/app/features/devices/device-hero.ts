import { marker } from '@jsverse/transloco-keys-manager/marker';
import { primaryCapability, type Device, type DeviceKind } from '@smart/contracts';
import type { UiProgressBandRange } from '@smart/ui';
import type { IconName } from '@smart/ui/shell';
import { NO_VALUE, chipOf, readingValue, type PodChip, type ReadingValue } from './device-pod';
import { capabilityLabelKey, formatNumber, isBatteryLow, isReading } from './device-values';

// Root keys (marked, so the key check finds them): the words are translated where they are shown.
const KIND_KEYS: Record<DeviceKind, string> = {
  light: marker('app.devices.kind.light'),
  soil: marker('app.devices.kind.soil'),
  climate: marker('app.devices.kind.climate'),
  contact: marker('app.devices.kind.contact'),
  other: marker('app.devices.kind.other'),
};

/** "Pflanze", "Lampe", ...: what sort of device this is, in the line under the name. */
export function kindKey(kind: DeviceKind): string {
  return KIND_KEYS[kind];
}

const METER_KEYS = {
  dry: marker('app.devices.hero.meter.dry'),
  wet: marker('app.devices.hero.meter.wet'),
  ok: marker('app.devices.hero.meter.ok'),
  plain: marker('app.devices.hero.meter.plain'),
} as const;

/** The soil moisture on its scale with the target range, read out in words for screen readers. */
export interface MeterView {
  readonly value: number;
  readonly band: UiProgressBandRange | null;
  readonly textKey: string;
  /** `value` is "18 %", `from` and `to` the ends of the target range as numbers. */
  readonly textParams: Readonly<Record<string, string>>;
}

/** The hero card of the device page (spec 3.3): the main value, its status and the target range. */
export interface DeviceHero extends ReadingValue {
  readonly kind: DeviceKind;
  /** The key of the main reading, for its name; undefined when the device reports nothing. */
  readonly capabilityKey: string | undefined;
  readonly chip: PodChip | null;
  readonly meter: MeterView | null;
  /** The device has not reported the main value yet: the dash needs a text for screen readers. */
  readonly missing: boolean;
}

/** Keeps the unit on the line of its number. */
const NBSP = String.fromCharCode(0xa0);

function meterOf(device: Device, locale: string): MeterView | null {
  const moisture = device.state['soil_moisture'];
  if (typeof moisture !== 'number' || !Number.isFinite(moisture)) return null;
  const { soilMoistureMin: min, soilMoistureMax: max } = device.effectiveThresholds;
  const capability = device.capabilities.find((entry) => entry.key === 'soil_moisture');
  const text = `${formatNumber(moisture, locale)}${NBSP}${capability?.unit ?? '%'}`;
  if (min === null && max === null) {
    return { value: moisture, band: null, textKey: METER_KEYS.plain, textParams: { value: text } };
  }
  const from = min ?? 0;
  const to = max ?? 100;
  const textKey =
    min !== null && moisture < min
      ? METER_KEYS.dry
      : max !== null && moisture > max
        ? METER_KEYS.wet
        : METER_KEYS.ok;
  return {
    value: moisture,
    band: { from, to, tone: 'ok' },
    textKey,
    textParams: { value: text, from: formatNumber(from, locale), to: formatNumber(to, locale) },
  };
}

export function heroOf(device: Device, locale: string): DeviceHero {
  const main = primaryCapability(device.capabilities);
  const reading = readingValue(main, main ? device.state[main.key] : undefined, locale);
  return {
    ...reading,
    missing: reading.value === NO_VALUE,
    kind: device.kind,
    capabilityKey: main?.key,
    chip: chipOf(device),
    meter: device.kind === 'soil' ? meterOf(device, locale) : null,
  };
}

/** A smaller value under the hero: a pod without a link (spec 3.3). */
export interface SidePod extends ReadingValue {
  readonly key: string;
  /** The translation key of the name; null for a capability the app has no name for. */
  readonly labelKey: string | null;
  readonly icon: IconName;
}

/** Shown first, in this order (spec 3.3: temperature, battery, signal); the rest follow. */
const SIDE_ORDER = ['temperature', 'humidity', 'battery', 'linkquality'];
const SIDE_ICONS: Readonly<Record<string, IconName>> = {
  temperature: 'thermostat',
  humidity: 'water_drop',
  battery: 'battery_full',
};
const SIDE_COUNT = 3;

/** The next readings after the main one: three pods, temperature, battery and signal first. */
export function sidePodsOf(device: Device, locale: string): SidePod[] {
  const main = primaryCapability(device.capabilities);
  const rank = (key: string) => {
    const index = SIDE_ORDER.indexOf(key);
    return index === -1 ? SIDE_ORDER.length : index;
  };
  return device.capabilities
    .filter((capability) => isReading(capability) && capability.key !== main?.key)
    .map((capability, index) => ({ capability, index }))
    .sort((a, b) => rank(a.capability.key) - rank(b.capability.key) || a.index - b.index)
    .slice(0, SIDE_COUNT)
    .map(({ capability }) => ({
      ...readingValue(capability, device.state[capability.key], locale),
      key: capability.key,
      labelKey: capabilityLabelKey(capability.key),
      icon:
        capability.key === 'battery' && isBatteryLow(device)
          ? 'battery_alert'
          : (SIDE_ICONS[capability.key] ?? 'sensors'),
    }));
}
