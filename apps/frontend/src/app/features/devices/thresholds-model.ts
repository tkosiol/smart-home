import { marker } from '@jsverse/transloco-keys-manager/marker';
import {
  DEFAULT_THRESHOLDS,
  effectiveThresholds,
  thresholdsSchema,
  type Device,
  type EffectiveThresholds,
  type Thresholds,
} from '@smart/contracts';

export type ThresholdKey = keyof EffectiveThresholds;

type ThresholdUnit = 'percent' | 'minutes';

interface FieldDefinition {
  readonly key: ThresholdKey;
  readonly unit: ThresholdUnit;
  readonly labelKey: string;
  /** The capability that makes the value matter; none: every device has it. */
  readonly needs: string | null;
}

// Root keys (marked, so the key check finds them): the labels are translated where they are shown.
const FIELDS: readonly FieldDefinition[] = [
  {
    key: 'soilMoistureMin',
    unit: 'percent',
    labelKey: marker('app.devices.thresholds.field.soilMoistureMin'),
    needs: 'soil_moisture',
  },
  {
    key: 'soilMoistureMax',
    unit: 'percent',
    labelKey: marker('app.devices.thresholds.field.soilMoistureMax'),
    needs: 'soil_moisture',
  },
  {
    key: 'batteryMin',
    unit: 'percent',
    labelKey: marker('app.devices.thresholds.field.batteryMin'),
    needs: 'battery',
  },
  {
    key: 'contactOpenMinutes',
    unit: 'minutes',
    labelKey: marker('app.devices.thresholds.field.contactOpenMinutes'),
    needs: 'contact',
  },
  {
    key: 'silentMinutes',
    unit: 'minutes',
    labelKey: marker('app.devices.thresholds.field.silentMinutes'),
    needs: null,
  },
];

/** Words around a number: the unit in a field's label, and a value as read-only text. */
const UNIT_KEYS: Record<ThresholdUnit, { readonly label: string; readonly value: string }> = {
  percent: {
    label: marker('app.devices.thresholds.unit.percent'),
    value: marker('app.devices.thresholds.value.percent'),
  },
  minutes: {
    label: marker('app.devices.thresholds.unit.minutes'),
    value: marker('app.devices.thresholds.value.minutes'),
  },
};

// Root keys (marked, so the key check finds them): the words are translated where they are shown.
const STATE_KEYS = {
  standard: marker('app.devices.thresholds.state.standard'),
  custom: marker('app.devices.thresholds.state.custom'),
  off: marker('app.devices.thresholds.off'),
} as const;

const ERROR_KEYS = {
  invalid: marker('app.devices.thresholds.error.invalid'),
  range: marker('app.devices.thresholds.error.range'),
  rejected: marker('app.devices.thresholds.error.rejected'),
} as const;

/**
 * Whether a value is the standard or the device's own, as words: `key` takes the parameter
 * `standard`, which is `standardKey` translated with `standardParams` (a value or "off").
 */
export interface ThresholdState {
  readonly key: string;
  readonly standardKey: string;
  readonly standardParams: { readonly value: number } | undefined;
}

/** What the card shows for one threshold of a device. */
export interface ThresholdRow {
  readonly key: ThresholdKey;
  readonly unit: ThresholdUnit;
  readonly labelKey: string;
  /** "%" or "Minuten", in the label of the field. */
  readonly unitKey: string;
  /** "{{ value }} %", for a value shown as text; the parameter is `value`. */
  readonly valueKey: string;
  /** The text the field starts with: the value in force, empty where there is none (maximum off). */
  readonly initial: string;
  /** The value in force; null: the threshold is off. */
  readonly value: number | null;
  /** Whether this device has its own value. */
  readonly custom: boolean;
  /** The kind's default; null: off. */
  readonly standard: number | null;
  /** "Standard" or "Angepasst (Standard: 25 %)". */
  readonly state: ThresholdState;
  /** The word for an off threshold, where it is shown as a value. */
  readonly offKey: string;
}

const formats = new Map<string, Intl.NumberFormat>();

/** A number as typed into a field: the language's decimal separator, no digit grouping. */
function fieldText(value: number, locale: string): string {
  let format = formats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale, { useGrouping: false, maximumFractionDigits: 20 });
    formats.set(locale, format);
  }
  return format.format(value);
}

/** The thresholds that fit the capabilities of the device, with their state (spec 4.3). */
export function thresholdRows(device: Device, locale: string): ThresholdRow[] {
  const has = (key: string) => device.capabilities.some((capability) => capability.key === key);
  const defaults = DEFAULT_THRESHOLDS[device.kind];
  return FIELDS.filter((field) => field.needs === null || has(field.needs)).map((field) => {
    const value = device.effectiveThresholds[field.key];
    const standard = defaults[field.key];
    const custom = device.thresholds[field.key] != null;
    const valueKey = UNIT_KEYS[field.unit].value;
    return {
      key: field.key,
      unit: field.unit,
      labelKey: field.labelKey,
      unitKey: UNIT_KEYS[field.unit].label,
      valueKey,
      initial: value === null ? '' : fieldText(value, locale),
      value,
      custom,
      standard,
      state: custom
        ? {
            key: STATE_KEYS.custom,
            standardKey: standard === null ? STATE_KEYS.off : valueKey,
            standardParams: standard === null ? undefined : { value: standard },
          }
        : { key: STATE_KEYS.standard, standardKey: STATE_KEYS.off, standardParams: undefined },
      offKey: STATE_KEYS.off,
    };
  });
}

/** The fields of the card that carry their own value; resetting sends `null` for each. */
export function customKeys(rows: readonly ThresholdRow[]): ThresholdKey[] {
  return rows.filter((row) => row.custom).map((row) => row.key);
}

/** A number as typed: digits with a point or comma; anything else is NaN. */
function parseNumber(text: string): number {
  const trimmed = text.trim().replace(',', '.');
  return /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

export type ThresholdPatch =
  | { readonly ok: true; readonly patch: Thresholds }
  /** The translation key of the error for each field that has one. */
  | { readonly ok: false; readonly errors: Partial<Record<ThresholdKey, string>> };

/**
 * The change to send: only fields whose number differs from the one in force ("31,0" is 31), a
 * number for a value and `null` for an emptied field that has its own value (back to the kind's
 * default; an emptied field that already shows the standard is no change). The contract's ranges
 * apply, and the range of the soil moisture is checked against the values in force, as the server
 * does. Nothing changed gives an empty patch.
 */
export function thresholdPatch(
  device: Device,
  rows: readonly ThresholdRow[],
  texts: Readonly<Partial<Record<ThresholdKey, string>>>,
): ThresholdPatch {
  const patch: Record<string, number | null> = {};
  const errors: Partial<Record<ThresholdKey, string>> = {};
  for (const row of rows) {
    const text = (texts[row.key] ?? row.initial).trim();
    if (text === '') {
      if (row.custom) patch[row.key] = null;
      continue;
    }
    const value = parseNumber(text);
    const parsed = thresholdsSchema.safeParse({ [row.key]: value });
    if (Number.isNaN(value) || !parsed.success) errors[row.key] = ERROR_KEYS.invalid;
    else if (value !== row.value) patch[row.key] = value;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const own: Thresholds = { ...device.thresholds };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete own[key as ThresholdKey];
    else Object.assign(own, { [key]: value });
  }
  const { soilMoistureMin: min, soilMoistureMax: max } = effectiveThresholds(device.kind, own);
  if (min !== null && max !== null && min >= max) {
    const changed = ['soilMoistureMin', 'soilMoistureMax'].filter((key) => key in patch);
    return {
      ok: false,
      errors: Object.fromEntries(
        (changed.length > 0 ? changed : ['soilMoistureMin']).map((key) => [key, ERROR_KEYS.range]),
      ),
    };
  }
  return { ok: true, patch: patch as Thresholds };
}

/** The error of every field the user changed, when the server refused the change (400). */
export function rejectedErrors(patch: Thresholds): Partial<Record<ThresholdKey, string>> {
  return Object.fromEntries(Object.keys(patch).map((key) => [key, ERROR_KEYS.rejected]));
}

/** The patch that sets the given thresholds back to the kind's defaults. */
export function resetPatch(keys: readonly ThresholdKey[]): Thresholds {
  return Object.fromEntries(keys.map((key) => [key, null])) as Thresholds;
}
