import {
  CAPABILITY_KEY_PATTERN,
  isCanonicalKey,
  vocabularyEntry,
  type CanonicalKey,
  type CapabilityKind,
} from '@smart/contracts';
import * as z from 'zod';
import type { ReportedCapability } from '../../core/adapters/index.js';

/** One entry of a Zigbee2MQTT definition's `exposes`, reduced to what capabilities need. */
export interface Expose {
  type: string;
  property?: string | undefined;
  /** Z2M access bits: 1 = published state, 2 = settable, 4 = gettable. */
  access?: number | undefined;
  unit?: string | undefined;
  value_min?: number | undefined;
  value_max?: number | undefined;
  value_step?: number | undefined;
  /** What a binary reports for on and off (`ON`/`OFF`, `LOCK`/`UNLOCK`, `true`/`false`, …). */
  value_on?: unknown;
  value_off?: unknown;
  values?: string[] | undefined;
  features?: Expose[] | undefined;
}

/** A feature that is malformed drops itself, not the features next to it. */
const keepWellFormed = (list: unknown[] | undefined): Expose[] | undefined =>
  list?.flatMap((entry) => {
    const parsed = exposeSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });

/**
 * Reads exposes leniently: a field of the wrong type counts as absent, so that one odd entry does
 * not cost the device its other capabilities. Only an entry that is no object (or has no `type`)
 * is rejected.
 */
const exposeSchema: z.ZodType<Expose> = z.lazy(() =>
  z.looseObject({
    type: z.string(),
    property: z.string().optional().catch(undefined),
    access: z.number().optional().catch(undefined),
    unit: z.string().optional().catch(undefined),
    value_min: z.number().optional().catch(undefined),
    value_max: z.number().optional().catch(undefined),
    value_step: z.number().optional().catch(undefined),
    value_on: z.unknown().optional(),
    value_off: z.unknown().optional(),
    values: z.array(z.string()).optional().catch(undefined),
    features: z.array(z.unknown()).optional().transform(keepWellFormed).catch(undefined),
  }),
);

export const exposesSchema = z.array(exposeSchema);

const PUBLISHED = 1;
const SETTABLE = 2;
/** Real definitions nest two levels (light, composite, member); more is not a definition. */
const MAX_DEPTH = 8;
/** Z2M's brightness range when a light does not say. */
const DEFAULT_BRIGHTNESS_MAX = 254;
const MIRED_PER_KELVIN = 1e6;
/** Names that mean the vocabulary's lamp controls only as features of these; a lock has a `state` too. */
const LAMP_KEYS = new Set<string>(['state', 'brightness', 'color_temp']);
const LAMP_PARENTS = new Set(['light', 'switch']);

const KINDS: Record<string, CapabilityKind> = {
  numeric: 'numeric',
  binary: 'binary',
  enum: 'enum',
  text: 'text',
};
const kindOf = (type: string): CapabilityKind => KINDS[type] ?? 'composite';

/** The vocabulary entry an expose stands for, if its name, kind and place all fit. */
function canonicalKeyOf(e: Expose, property: string, parentType: string | undefined) {
  if (!isCanonicalKey(property)) return undefined;
  if (vocabularyEntry(property).kind !== e.type) return undefined;
  if (LAMP_KEYS.has(property) && !LAMP_PARENTS.has(parentType ?? '')) return undefined;
  return property;
}

/**
 * Flattens Z2M exposes (incl. features of light/switch/composite) into capabilities, named by the
 * vocabulary where they mean the same and passed through otherwise (`_z2m` if the name is taken).
 */
export function capabilitiesFromExposes(exposes: readonly Expose[]): ReportedCapability[] {
  const out: ReportedCapability[] = [];
  const visit = (e: Expose, depth: number, parentType: string | undefined) => {
    if (depth > MAX_DEPTH) return;
    if (e.features && e.type !== 'composite') {
      for (const feature of e.features) visit(feature, depth + 1, e.type);
      return;
    }
    if (!e.property || !CAPABILITY_KEY_PATTERN.test(e.property)) return;
    const canonical = canonicalKeyOf(e, e.property, parentType);
    out.push(canonical ? canonicalCapability(e, canonical) : passedThrough(e, e.property));
  };
  for (const expose of exposes) visit(expose, 0, undefined);
  return dedupeByKey(out);
}

function access(e: Expose) {
  const readable = ((e.access ?? 0) & PUBLISHED) !== 0;
  const writable = ((e.access ?? 0) & SETTABLE) !== 0;
  // Settable and published: a setting of the device (calibration, sampling, thresholds), not a reading.
  return { readable, writable, isSetting: readable && writable && e.type !== 'binary' };
}

/** What only the adapter reads back: the name in Z2M's state and how to turn it into the vocabulary. */
function nativeOf(e: Expose, property: string, canonical?: CanonicalKey): Record<string, unknown> {
  const native: Record<string, unknown> = { property };
  if (e.type === 'binary') {
    if (e.value_on !== undefined) native.valueOn = e.value_on;
    if (e.value_off !== undefined) native.valueOff = e.value_off;
  }
  if (canonical === 'brightness') native.max = e.value_max ?? DEFAULT_BRIGHTNESS_MAX;
  return native;
}

function canonicalCapability(e: Expose, key: CanonicalKey): ReportedCapability {
  const entry = vocabularyEntry(key);
  const { readable, writable, isSetting } = access(e);
  let { min, max } = entry;
  if (key === 'color_temp') {
    // Z2M speaks mired, the vocabulary Kelvin: the warmest end (most mired) is the lowest Kelvin.
    // An adapter may only narrow the vocabulary's range, never widen it.
    const { value_min: lowMired = 0, value_max: highMired = 0 } = e;
    const inRange = (kelvin: number) =>
      Math.min(entry.max ?? Infinity, Math.max(entry.min ?? -Infinity, Math.round(kelvin)));
    min = highMired > 0 ? inRange(MIRED_PER_KELVIN / highMired) : entry.min;
    max = lowMired > 0 ? inRange(MIRED_PER_KELVIN / lowMired) : entry.max;
  }
  return {
    key,
    kind: entry.kind,
    unit: entry.unit,
    min,
    max,
    step: null,
    enumValues: null,
    readable,
    writable,
    // A control is switched by people, never a setting of the device.
    isSetting: entry.role === 'reading' ? isSetting : false,
    // A canonical key is the Z2M name itself.
    native: nativeOf(e, key, key),
  };
}

function passedThrough(e: Expose, property: string): ReportedCapability {
  return {
    key: isCanonicalKey(property) ? `${property}_z2m` : property,
    kind: kindOf(e.type),
    unit: e.unit ?? null,
    min: e.value_min ?? null,
    max: e.value_max ?? null,
    step: e.value_step ?? null,
    enumValues: e.values ?? null,
    ...access(e),
    native: nativeOf(e, property),
  };
}

/** A key twice (a composite and its member, or an option next to an expose) keeps the first. */
function dedupeByKey(list: ReportedCapability[]): ReportedCapability[] {
  const seen = new Set<string>();
  return list.filter((capability) => {
    if (seen.has(capability.key)) return false;
    seen.add(capability.key);
    return true;
  });
}
