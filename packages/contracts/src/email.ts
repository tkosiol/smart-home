import * as z from 'zod/mini';

/** Canonical form of an e-mail address for lookups and comparisons. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Normalizes first, then validates the address. */
export const emailSchema = z.pipe(z.pipe(z.string(), z.transform(normalizeEmail)), z.email());
