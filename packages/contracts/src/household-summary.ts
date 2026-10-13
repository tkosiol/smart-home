import * as z from 'zod/mini';

// Apart from households.ts so that `me` (auth.ts, loaded at app start) does not pull in every
// household and invitation schema.

/** Ascending by privilege: a later role may do everything an earlier one may. */
export const HOUSEHOLD_ROLES = ['viewer', 'member', 'owner'] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];
export const householdRoleSchema = z.enum(HOUSEHOLD_ROLES);

/** True when `role` grants at least `minimum`. */
export function hasRole(role: HouseholdRole, minimum: HouseholdRole): boolean {
  return HOUSEHOLD_ROLES.indexOf(role) >= HOUSEHOLD_ROLES.indexOf(minimum);
}

export const householdSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  timezone: z.string(),
  role: householdRoleSchema,
});
export type HouseholdSummary = z.infer<typeof householdSummarySchema>;
