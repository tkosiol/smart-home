import * as z from 'zod/mini';
import { gatewayIdSchema } from './gateways.js';
import { displayNameSchema } from './households.js';
import { effectiveThresholdsSchema, LOW_BATTERY_PERCENT, thresholdsSchema } from './thresholds.js';

export { LOW_BATTERY_PERCENT };

export const CAPABILITY_KINDS = ['numeric', 'binary', 'enum', 'text', 'composite'] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];
export const capabilityKindSchema = z.enum(CAPABILITY_KINDS);

/** One thing a piece of hardware reports or accepts: a measurement, a switch or a setting. */
export const capabilitySchema = z.object({
  key: z.string(),
  kind: capabilityKindSchema,
  unit: z.nullable(z.string()),
  min: z.nullable(z.number()),
  max: z.nullable(z.number()),
  step: z.nullable(z.number()),
  enumValues: z.nullable(z.array(z.string())),
  readable: z.boolean(),
  writable: z.boolean(),
  /** A configuration value of the hardware (calibration, units), not a measurement or control. */
  isSetting: z.boolean(),
});
export type Capability = z.infer<typeof capabilitySchema>;

export const AVAILABILITIES = ['online', 'offline', 'unknown'] as const;
export type Availability = (typeof AVAILABILITIES)[number];
export const availabilitySchema = z.enum(AVAILABILITIES);

/** A physical device as a gateway reports it; households turn it into a device. */
export const hardwareSchema = z.object({
  id: z.string(),
  gatewayId: gatewayIdSchema,
  ieeeAddress: z.string(),
  friendlyName: z.string(),
  vendor: z.string(),
  model: z.string(),
  description: z.nullable(z.string()),
  availability: availabilitySchema,
  /** ISO 8601 UTC (`…Z`). */
  lastSeenAt: z.nullable(z.string()),
  lastState: z.record(z.string(), z.unknown()),
  capabilities: z.array(capabilitySchema),
});
export type Hardware = z.infer<typeof hardwareSchema>;

/** A household's named device on top of a piece of hardware. */
export const deviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.nullable(z.string()),
  hardware: z.object({
    id: z.string(),
    vendor: z.string(),
    model: z.string(),
    description: z.nullable(z.string()),
  }),
  availability: availabilitySchema,
  /** ISO 8601 UTC (`…Z`). */
  lastSeenAt: z.nullable(z.string()),
  state: z.record(z.string(), z.unknown()),
  /** Readable capabilities without settings. */
  capabilities: z.array(capabilitySchema),
  /** The thresholds set on this device; a missing field uses the kind's default. */
  thresholds: thresholdsSchema,
  /** The thresholds in force: the device's own value, else the default of its kind. */
  effectiveThresholds: effectiveThresholdsSchema,
});
export type Device = z.infer<typeof deviceSchema>;

export const deviceCreateSchema = z.object({
  hardwareId: z.string(),
  name: displayNameSchema,
});
export type DeviceCreate = z.infer<typeof deviceCreateSchema>;

export const deviceRenameSchema = z.object({ name: displayNameSchema });
export type DeviceRename = z.infer<typeof deviceRenameSchema>;

/**
 * A change to a device: its name and/or thresholds. A threshold that is set overwrites, `null`
 * removes it (the kind's default applies again), a missing one stays.
 */
export const deviceUpdateSchema = z
  .object({
    name: z.optional(displayNameSchema),
    thresholds: z.optional(thresholdsSchema),
  })
  .check(
    z.refine(({ name, thresholds }) => name !== undefined || thresholds !== undefined, {
      message: 'name or thresholds is required',
    }),
  );
export type DeviceUpdate = z.infer<typeof deviceUpdateSchema>;

/** Keys shown first, in this order. */
const PRIMARY_KEYS = ['soil_moisture', 'temperature', 'humidity', 'state'] as const;

/**
 * The value shown first: soil_moisture, temperature, humidity, state, else the first numeric one.
 * Only readings count: capabilities that are not readable or are settings are skipped.
 */
export function primaryCapability(capabilities: readonly Capability[]): Capability | undefined {
  const readings = capabilities.filter(
    (capability) => capability.readable && !capability.isSetting,
  );
  for (const key of PRIMARY_KEYS) {
    const found = readings.find((capability) => capability.key === key);
    if (found) return found;
  }
  return readings.find((capability) => capability.kind === 'numeric');
}

/** True for a finite battery percentage below {@link LOW_BATTERY_PERCENT}; anything else is not low. */
export function isLowBattery(percent: unknown): boolean {
  return typeof percent === 'number' && Number.isFinite(percent) && percent < LOW_BATTERY_PERCENT;
}

export const DEVICE_KINDS = ['light', 'soil', 'climate', 'contact', 'other'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/**
 * light: writable `state` or `brightness`; soil: `soil_moisture`; climate: `temperature`/`humidity`
 * without `soil_moisture`; contact: `contact`; else other.
 */
export function deviceKind(capabilities: readonly Capability[]): DeviceKind {
  const has = (key: string): boolean => capabilities.some((capability) => capability.key === key);
  if (
    capabilities.some(
      (capability) =>
        capability.writable && (capability.key === 'state' || capability.key === 'brightness'),
    )
  ) {
    return 'light';
  }
  if (has('soil_moisture')) return 'soil';
  if (has('temperature') || has('humidity')) return 'climate';
  if (has('contact')) return 'contact';
  return 'other';
}
