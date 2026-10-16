import { marker } from '@jsverse/transloco-keys-manager/marker';
import type { Capability, Device } from '@smart/contracts';

/** How a reading is shown; binary words depend on the key, so the component picks the text. */
export type ReadingView =
  | { readonly kind: 'missing' }
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'binary';
      readonly on: boolean;
      /** `dry`: "trocken"/"nicht trocken", `power`: "an"/"aus", else "ja"/"nein". */
      readonly style: 'yesNo' | 'dry' | 'power';
    };

/** Keeps the unit on the line of its number. */
const NBSP = String.fromCharCode(0xa0);

const formatters = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string): Intl.NumberFormat {
  let format = formatters.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    formatters.set(locale, format);
  }
  return format;
}

/** A number as `formatReading` shows it, without a unit. */
export function formatNumber(value: number, locale: string): string {
  return numberFormat(locale).format(value);
}

export function binaryOf(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'ON') return true;
  if (value === 'OFF') return false;
  return undefined;
}

/**
 * The value of one capability for display: numbers in the language's format with their unit, binary
 * values as a state, enum and text as they are. No value, or one that does not fit the capability,
 * is "missing" (composite values are not shown at all).
 */
export function formatReading(capability: Capability, value: unknown, locale: string): ReadingView {
  switch (capability.kind) {
    case 'numeric': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return { kind: 'missing' };
      const number = numberFormat(locale).format(value);
      return {
        kind: 'text',
        text: capability.unit ? `${number}${NBSP}${capability.unit}` : number,
      };
    }
    case 'binary': {
      const on = binaryOf(value);
      if (on === undefined) return { kind: 'missing' };
      const style =
        capability.key === 'dry' ? 'dry' : capability.key === 'state' ? 'power' : 'yesNo';
      return { kind: 'binary', on, style };
    }
    case 'enum':
    case 'text':
      return typeof value === 'string' && value !== ''
        ? { kind: 'text', text: value }
        : { kind: 'missing' };
    case 'composite':
      return { kind: 'missing' };
  }
}

/** A measurement or state to show: readable, no setting, no composite value. */
export function isReading(capability: Capability): boolean {
  return capability.readable && !capability.isSetting && capability.kind !== 'composite';
}

export function readingsOf(device: Pick<Device, 'capabilities'>): Capability[] {
  return device.capabilities.filter(isReading);
}

/** The battery's value in percent, when the device reports one. */
export function batteryPercent(device: Pick<Device, 'state'>): number | undefined {
  const value = device.state['battery'];
  return typeof value === 'number' ? value : undefined;
}

/**
 * The battery is low when it is below the device's own limit (its effective `batteryMin`, the
 * same rule as the chip and the server), not a fixed percentage.
 */
export function isBatteryLow(device: Pick<Device, 'state' | 'effectiveThresholds'>): boolean {
  const level = batteryPercent(device);
  return level !== undefined && level < device.effectiveThresholds.batteryMin;
}

// Root keys (marked, so the key check finds them): the name is translated where it is shown.
const CAPABILITY_LABELS: Readonly<Record<string, string>> = {
  soil_moisture: marker('app.devices.capability.soil_moisture'),
  temperature: marker('app.devices.capability.temperature'),
  humidity: marker('app.devices.capability.humidity'),
  battery: marker('app.devices.capability.battery'),
  dry: marker('app.devices.capability.dry'),
  linkquality: marker('app.devices.capability.linkquality'),
  state: marker('app.devices.capability.state'),
  brightness: marker('app.devices.capability.brightness'),
  color_temp: marker('app.devices.capability.color_temp'),
};

/** The translation key for the name of a capability, or null for one the app has no name for. */
export function capabilityLabelKey(key: string): string | null {
  return Object.hasOwn(CAPABILITY_LABELS, key) ? (CAPABILITY_LABELS[key] ?? null) : null;
}
