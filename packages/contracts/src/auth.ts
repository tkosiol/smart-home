import * as z from 'zod/mini';
import { personalAppearanceSchema } from './appearance.js';
import { emailSchema, normalizeEmail } from './email.js';
import { householdSummarySchema } from './households.js';
import { languageSchema } from './language.js';

// Lives in email.ts so households.ts can use it without an import cycle through this file.
export { emailSchema, normalizeEmail };

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
  households: z.array(householdSummarySchema),
  currentHouseholdId: z.nullable(z.string()),
});
export type Me = z.infer<typeof meSchema>;

export const preferencesUpdateSchema = z.object({
  locale: z.optional(languageSchema),
  appearance: z.optional(personalAppearanceSchema),
});
export type PreferencesUpdate = z.infer<typeof preferencesUpdateSchema>;
