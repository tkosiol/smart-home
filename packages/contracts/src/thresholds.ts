import * as z from 'zod/mini';
import { LOW_BATTERY_PERCENT, type DeviceKind } from './devices.js';

const percent = z.nullable(z.number().check(z.gte(0), z.lte(100)));
const minutes = z.nullable(z.int().check(z.gte(1), z.lte(10080)));

/** A device's own thresholds; a missing or null field means "use the kind's default". */
export const thresholdsSchema = z
  .object({
    soilMoistureMin: z.optional(percent),
    soilMoistureMax: z.optional(percent),
    batteryMin: z.optional(percent),
    contactOpenMinutes: z.optional(minutes),
    silentMinutes: z.optional(minutes),
  })
  .check(
    z.refine(
      ({ soilMoistureMin, soilMoistureMax }) =>
        typeof soilMoistureMin !== 'number' ||
        typeof soilMoistureMax !== 'number' ||
        soilMoistureMin < soilMoistureMax,
      { message: 'soilMoistureMin must be below soilMoistureMax', path: ['soilMoistureMin'] },
    ),
  );
export type Thresholds = z.infer<typeof thresholdsSchema>;

export interface EffectiveThresholds {
  soilMoistureMin: number | null;
  soilMoistureMax: number | null;
  batteryMin: number;
  contactOpenMinutes: number;
  silentMinutes: number;
}

const BASE_THRESHOLDS: EffectiveThresholds = {
  soilMoistureMin: null,
  soilMoistureMax: null,
  batteryMin: LOW_BATTERY_PERCENT,
  contactOpenMinutes: 10,
  silentMinutes: 120,
};

export const DEFAULT_THRESHOLDS: Record<DeviceKind, EffectiveThresholds> = {
  light: { ...BASE_THRESHOLDS },
  soil: { ...BASE_THRESHOLDS, soilMoistureMin: 25 },
  climate: { ...BASE_THRESHOLDS },
  contact: { ...BASE_THRESHOLDS },
  other: { ...BASE_THRESHOLDS },
};

/** A gateway counts as offline after this many minutes without contact. */
export const GATEWAY_OFFLINE_MINUTES = 5;

/** device value ?? kind default; null in `own` means "use the default". */
export function effectiveThresholds(
  kind: DeviceKind,
  own: Thresholds | null | undefined,
): EffectiveThresholds {
  const defaults = DEFAULT_THRESHOLDS[kind];
  return {
    soilMoistureMin: own?.soilMoistureMin ?? defaults.soilMoistureMin,
    soilMoistureMax: own?.soilMoistureMax ?? defaults.soilMoistureMax,
    batteryMin: own?.batteryMin ?? defaults.batteryMin,
    contactOpenMinutes: own?.contactOpenMinutes ?? defaults.contactOpenMinutes,
    silentMinutes: own?.silentMinutes ?? defaults.silentMinutes,
  };
}
