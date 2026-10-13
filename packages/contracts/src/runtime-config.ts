import { instanceAppearanceSchema, type InstanceAppearance } from './appearance.js';

/** Served as /config.json by the web container, written from SMART_* environment variables. */
export interface RuntimeConfig {
  /** Instance default set by the hoster; the server's value wins over it, it wins over the build default (spec 3.8). */
  readonly instanceAppearance?: InstanceAppearance;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {};

/** Lenient: an invalid part falls back to the default. Fields of older versions (`features`) are ignored. */
export function parseRuntimeConfig(raw: unknown): RuntimeConfig {
  const record =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const appearance = instanceAppearanceSchema.safeParse(record['instanceAppearance']);
  return appearance.success ? { instanceAppearance: appearance.data } : {};
}
