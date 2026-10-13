import * as z from 'zod/mini';
import { instanceAppearanceSchema } from './appearance.js';
import { emailSchema } from './email.js';
import { householdRoleSchema } from './household-summary.js';
import { languageSchema } from './language.js';

// Defined apart (see household-summary.ts), part of this module's API all the same.
export {
  HOUSEHOLD_ROLES,
  hasRole,
  householdRoleSchema,
  householdSummarySchema,
  type HouseholdRole,
  type HouseholdSummary,
} from './household-summary.js';

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

/** The secret of an invitation link; sent in the body, never in a URL. */
const invitationTokenField = z.string().check(z.minLength(1), z.maxLength(100));

export const invitationTokenSchema = z.object({ token: invitationTokenField });
export type InvitationToken = z.infer<typeof invitationTokenSchema>;

export const invitationAcceptNewSchema = z.object({
  token: invitationTokenField,
  displayName: displayNameSchema,
  locale: languageSchema,
});
export type InvitationAcceptNew = z.infer<typeof invitationAcceptNewSchema>;

export const instanceAppearanceUpdateSchema = z.object({
  appearance: z.nullable(instanceAppearanceSchema),
});
export type InstanceAppearanceUpdate = z.infer<typeof instanceAppearanceUpdateSchema>;
