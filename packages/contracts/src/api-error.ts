import * as z from 'zod/mini';

/** Stable, machine-readable error codes; the frontend maps them to translated messages. */
export const API_ERROR_CODES = [
  'auth.required',
  'auth.badOrigin',
  'auth.invalidCode',
  'auth.codeExpired',
  'auth.tooManyAttempts',
  'auth.rateLimited',
  'auth.mailDisabled',
  'validation.failed',
  'internal',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const apiErrorSchema = z.object({
  code: z.enum(API_ERROR_CODES),
  params: z.optional(z.record(z.string(), z.union([z.string(), z.number()]))),
  traceId: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
