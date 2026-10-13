import * as z from 'zod/mini';
import { personalAppearanceSchema } from './appearance.js';
import { languageSchema } from './language.js';

/** Canonical form of an e-mail address for lookups and comparisons. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Normalizes first, then validates the address. */
const emailSchema = z.pipe(z.pipe(z.string(), z.transform(normalizeEmail)), z.email());

export const emailCodeRequestSchema = z.object({ email: emailSchema });
export type EmailCodeRequest = z.infer<typeof emailCodeRequestSchema>;

export const emailCodeVerifySchema = z.object({
  email: emailSchema,
  code: z.string().check(z.regex(/^\d{6}$/, 'expected 6 digits')),
});
export type EmailCodeVerify = z.infer<typeof emailCodeVerifySchema>;

export const meSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  locale: languageSchema,
  appearance: personalAppearanceSchema,
  isPlatformAdmin: z.boolean(),
});
export type Me = z.infer<typeof meSchema>;

export const preferencesUpdateSchema = z.object({
  locale: z.optional(languageSchema),
  appearance: z.optional(personalAppearanceSchema),
});
export type PreferencesUpdate = z.infer<typeof preferencesUpdateSchema>;
