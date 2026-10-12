import * as z from 'zod/mini';
import { instanceAppearanceSchema, type InstanceAppearance } from './appearance.js';

/** Served as /config.json by the web container, written from SMART_* environment variables. */
export interface RuntimeConfig {
  readonly features: { readonly instanceAppearanceEditor: boolean };
  /** Instance default set by the hoster; overrides the build default (spec 4.5). */
  readonly instanceAppearance?: InstanceAppearance;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  features: { instanceAppearanceEditor: false },
};

const featuresSchema = z.object({ instanceAppearanceEditor: z.boolean() });

/** Lenient: each invalid part falls back on its own, so one typo cannot switch everything off. */
export function parseRuntimeConfig(raw: unknown): RuntimeConfig {
  const record =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const features = featuresSchema.safeParse(record['features']);
  const appearance = instanceAppearanceSchema.safeParse(record['instanceAppearance']);
  return {
    features: features.success ? features.data : DEFAULT_RUNTIME_CONFIG.features,
    ...(appearance.success ? { instanceAppearance: appearance.data } : {}),
  };
}
