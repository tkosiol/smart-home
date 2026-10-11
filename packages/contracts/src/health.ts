import * as z from 'zod/mini';

export const healthLiveResponseSchema = z.object({
  status: z.literal('ok'),
});
export type HealthLiveResponse = z.infer<typeof healthLiveResponseSchema>;

export const dependencyStatusSchema = z.enum(['up', 'down']);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

export const healthReadyResponseSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  checks: z.object({
    database: dependencyStatusSchema,
    broker: dependencyStatusSchema,
  }),
});
export type HealthReadyResponse = z.infer<typeof healthReadyResponseSchema>;
