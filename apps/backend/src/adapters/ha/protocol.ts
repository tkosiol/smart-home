import * as z from 'zod';

/** Version of the payloads the Home Assistant integration publishes (`integrations/home-assistant/fixtures`). */
export const PROTOCOL_VERSION = 1;

/** Also the shape `classify` accepts for a device topic. */
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const text = z.string().nullable().catch(null);

/**
 * One entity of a device, read leniently: a field of the wrong type counts as absent, so that one
 * odd value does not cost the device its other entities. Only an entry without `entity_id` and
 * `domain` is rejected.
 */
export const haEntitySchema = z.object({
  entity_id: z.string().min(1),
  domain: z.string().min(1),
  device_class: text,
  name: text,
  unit: text,
  capabilities: z.record(z.string(), z.unknown()).nullable().catch(null),
  entity_category: text,
});
export type HaEntity = z.infer<typeof haEntitySchema>;

/** The entries are parsed one by one: a malformed one must not cost the others. */
const keepWellFormed = (list: unknown[]): HaEntity[] =>
  list.flatMap((entry) => {
    const parsed = haEntitySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });

export const haDeviceSchema = z.object({
  id: z.string().regex(DEVICE_ID_PATTERN),
  name: text,
  manufacturer: text,
  model: text,
  area: text,
  entities: z.array(z.unknown()).transform(keepWellFormed).catch([]),
});
export type HaDevice = z.infer<typeof haDeviceSchema>;

export const haDevicesSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  devices: z.array(z.unknown()),
});

/** The state of one entity in a snapshot; every field may be missing. */
export const haEntityStateSchema = z.object({
  state: z.string().optional().catch(undefined),
  attributes: z.record(z.string(), z.unknown()).optional().catch(undefined),
  last_updated: z.string().optional().catch(undefined),
});
export type HaEntityState = z.infer<typeof haEntityStateSchema>;

export const haSnapshotSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  entities: z.record(z.string(), z.unknown()),
});

/** The entities of a snapshot that are well-formed, by `entity_id`; anything else is of no use. */
export function entityStates(snapshot: unknown): Map<string, HaEntityState> {
  const states = new Map<string, HaEntityState>();
  const parsed = haSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) return states;
  for (const [entityId, raw] of Object.entries(parsed.data.entities)) {
    const state = haEntityStateSchema.safeParse(raw);
    if (state.success) states.set(entityId, state.data);
  }
  return states;
}
