/** The platform's own names for what devices measure or accept; every gateway adapter maps onto them. */
export interface VocabularyEntry {
  key: string;
  kind: 'numeric' | 'binary';
  unit: string | null;
  min: number | null;
  max: number | null;
  /** A control is switched or set by people; it is never a setting of the device. */
  role: 'reading' | 'control';
}

/**
 * Append only. The keys are the ones stored before the vocabulary existed, so history, thresholds
 * and translations keep working. Binary values are always `true`/`false`.
 */
export const CAPABILITY_VOCABULARY = [
  { key: 'temperature', kind: 'numeric', unit: '°C', min: null, max: null, role: 'reading' },
  { key: 'humidity', kind: 'numeric', unit: '%', min: 0, max: 100, role: 'reading' },
  { key: 'soil_moisture', kind: 'numeric', unit: '%', min: 0, max: 100, role: 'reading' },
  { key: 'battery', kind: 'numeric', unit: '%', min: 0, max: 100, role: 'reading' },
  { key: 'linkquality', kind: 'numeric', unit: 'lqi', min: 0, max: 255, role: 'reading' },
  { key: 'contact', kind: 'binary', unit: null, min: null, max: null, role: 'reading' },
  { key: 'state', kind: 'binary', unit: null, min: null, max: null, role: 'control' },
  { key: 'brightness', kind: 'numeric', unit: '%', min: 0, max: 100, role: 'control' },
  { key: 'color_temp', kind: 'numeric', unit: 'K', min: 1000, max: 10000, role: 'control' },
] as const satisfies readonly VocabularyEntry[];

export type CanonicalKey = (typeof CAPABILITY_VOCABULARY)[number]['key'];
export const CANONICAL_KEYS = CAPABILITY_VOCABULARY.map(
  (entry) => entry.key,
) as readonly CanonicalKey[];

/** What any capability key, canonical or passed through by an adapter, must look like. */
export const CAPABILITY_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

const BY_KEY = new Map<string, VocabularyEntry>(
  CAPABILITY_VOCABULARY.map((entry) => [entry.key, entry]),
);

export function isCanonicalKey(key: string): key is CanonicalKey {
  return BY_KEY.has(key);
}

export function vocabularyEntry(key: CanonicalKey): VocabularyEntry {
  // Every CanonicalKey is in the map by construction.
  return BY_KEY.get(key) as VocabularyEntry;
}
