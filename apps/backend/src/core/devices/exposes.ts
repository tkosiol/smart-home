import type { Capability, CapabilityKind } from '@smart/contracts';
import * as z from 'zod';

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
  values?: string[] | undefined;
  features?: Expose[] | undefined;
}

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
    values: z.array(z.string()).optional().catch(undefined),
    features: z.array(exposeSchema).optional().catch(undefined),
  }),
);

export const exposesSchema = z.array(exposeSchema);

const PUBLISHED = 1;
const SETTABLE = 2;
/** Real definitions nest two levels (light, composite, member); more is not a definition. */
const MAX_DEPTH = 8;

const KINDS: Record<string, CapabilityKind> = {
  numeric: 'numeric',
  binary: 'binary',
  enum: 'enum',
  text: 'text',
};
const kindOf = (type: string): CapabilityKind => KINDS[type] ?? 'composite';

/** Flattens Z2M exposes (incl. features of light/switch/composite) into capabilities. */
export function capabilitiesFromExposes(exposes: readonly Expose[]): Capability[] {
  const out: Capability[] = [];
  const visit = (e: Expose, depth: number) => {
    if (depth > MAX_DEPTH) return;
    if (e.features && e.type !== 'composite') {
      for (const feature of e.features) visit(feature, depth + 1);
      return;
    }
    if (!e.property) return;
    const readable = ((e.access ?? 0) & PUBLISHED) !== 0;
    const writable = ((e.access ?? 0) & SETTABLE) !== 0;
    out.push({
      key: e.property,
      kind: kindOf(e.type),
      unit: e.unit ?? null,
      min: e.value_min ?? null,
      max: e.value_max ?? null,
      step: e.value_step ?? null,
      enumValues: e.values ?? null,
      readable,
      writable,
      // Settable and published: a setting of the device (calibration, sampling, thresholds), not a reading.
      isSetting:
        readable &&
        writable &&
        e.type !== 'binary' &&
        !['state', 'brightness', 'color_temp'].includes(e.property),
    });
  };
  for (const expose of exposes) visit(expose, 0);
  return dedupeByKey(out);
}

/** A key twice (a composite and its member, or an option next to an expose) keeps the first. */
function dedupeByKey(list: Capability[]): Capability[] {
  const seen = new Set<string>();
  return list.filter((capability) => {
    if (seen.has(capability.key)) return false;
    seen.add(capability.key);
    return true;
  });
}
