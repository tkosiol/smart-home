import * as z from 'zod/mini';
import { instanceAppearanceSchema } from './appearance.js';
import { emailSchema } from './email.js';
import { languageSchema } from './language.js';

/** Ascending by privilege: a later role may do everything an earlier one may. */
export const HOUSEHOLD_ROLES = ['viewer', 'member', 'owner'] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];
export const householdRoleSchema = z.enum(HOUSEHOLD_ROLES);

/** True when `role` grants at least `minimum`. */
export function hasRole(role: HouseholdRole, minimum: HouseholdRole): boolean {
  return HOUSEHOLD_ROLES.indexOf(role) >= HOUSEHOLD_ROLES.indexOf(minimum);
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

/** Name of a person or household: trimmed, 1–60 characters, no control characters. */
export const displayNameSchema = z.string().check(
  z.trim(),
  z.minLength(1),
  z.maxLength(60),
  z.refine((value) => !hasControlCharacter(value), 'control characters are not allowed'),
);

/** An IANA time zone name the runtime knows. */
export const timeZoneSchema = z.string().check(
  z.refine((timeZone) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone });
      return true;
    } catch {
      return false;
    }
  }, 'unknown time zone'),
);

export const householdSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  timezone: z.string(),
  role: householdRoleSchema,
});
export type HouseholdSummary = z.infer<typeof householdSummarySchema>;

export const householdCreateSchema = z.object({
  name: displayNameSchema,
  timezone: timeZoneSchema,
});
export type HouseholdCreate = z.infer<typeof householdCreateSchema>;

export const householdUpdateSchema = z.object({
  name: z.optional(displayNameSchema),
  timezone: z.optional(timeZoneSchema),
});
export type HouseholdUpdate = z.infer<typeof householdUpdateSchema>;

export const currentHouseholdUpdateSchema = z.object({ householdId: z.string() });
export type CurrentHouseholdUpdate = z.infer<typeof currentHouseholdUpdateSchema>;

export const memberSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  email: z.string(),
  role: householdRoleSchema,
  /** ISO 8601 UTC (`…Z`). */
  joinedAt: z.string(),
});
export type Member = z.infer<typeof memberSchema>;

export const memberRoleUpdateSchema = z.object({ role: householdRoleSchema });
export type MemberRoleUpdate = z.infer<typeof memberRoleUpdateSchema>;

export const invitationCreateSchema = z.object({
  email: emailSchema,
  role: householdRoleSchema,
});
export type InvitationCreate = z.infer<typeof invitationCreateSchema>;

export const invitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: householdRoleSchema,
  invitedByName: z.string(),
  /** ISO 8601 UTC (`…Z`). */
  createdAt: z.string(),
  /** ISO 8601 UTC (`…Z`). */
  expiresAt: z.string(),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const invitationCreatedSchema = z.object({
  invitation: invitationSchema,
  link: z.string(),
});
export type InvitationCreated = z.infer<typeof invitationCreatedSchema>;

export const invitationPreviewSchema = z.object({
  householdName: z.string(),
  role: householdRoleSchema,
  email: z.string(),
  invitedByName: z.string(),
  accountExists: z.boolean(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

export const invitationAcceptNewSchema = z.object({
  displayName: displayNameSchema,
  locale: languageSchema,
});
export type InvitationAcceptNew = z.infer<typeof invitationAcceptNewSchema>;

export const instanceAppearanceUpdateSchema = z.object({
  appearance: z.nullable(instanceAppearanceSchema),
});
export type InstanceAppearanceUpdate = z.infer<typeof instanceAppearanceUpdateSchema>;
