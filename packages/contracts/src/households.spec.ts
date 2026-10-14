import { describe, expect, it } from 'vitest';
import {
  HOUSEHOLD_ROLES,
  currentHouseholdUpdateSchema,
  displayNameSchema,
  hasRole,
  householdCreateSchema,
  householdUpdateSchema,
  instanceAppearanceUpdateSchema,
  invitationAcceptNewSchema,
  invitationCreateSchema,
  invitationCreatedSchema,
  invitationPreviewSchema,
  invitationSchema,
  invitationTokenSchema,
  memberRoleUpdateSchema,
  memberSchema,
  timeZoneSchema,
  type HouseholdRole,
} from './households.js';
import { DEFAULT_INSTANCE_APPEARANCE } from './appearance.js';

describe('hasRole', () => {
  const rank: Record<HouseholdRole, number> = { viewer: 0, member: 1, owner: 2 };
  const pairs = HOUSEHOLD_ROLES.flatMap((role) =>
    HOUSEHOLD_ROLES.map((minimum) => [role, minimum] as const),
  );

  it('covers all nine pairs', () => {
    expect(pairs).toHaveLength(9);
  });

  it.each(pairs)('role %s against minimum %s', (role, minimum) => {
    expect(hasRole(role, minimum)).toBe(rank[role] >= rank[minimum]);
  });
});

describe('displayNameSchema', () => {
  it('trims', () => {
    expect(displayNameSchema.safeParse('  Till  ').data).toBe('Till');
  });

  it('accepts 1 and 60 characters', () => {
    expect(displayNameSchema.safeParse('a').success).toBe(true);
    expect(displayNameSchema.safeParse('a'.repeat(60)).success).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['61 characters', 'a'.repeat(61)],
    ['a line break', 'Till\nKosiol'],
    ['a tab', 'Till\tKosiol'],
    ['DEL', 'Till\u007f'],
  ])('rejects %s', (_name, value) => {
    expect(displayNameSchema.safeParse(value).success).toBe(false);
  });
});

describe('timeZoneSchema', () => {
  it.each(['Europe/Berlin', 'Pacific/Chatham'])('accepts %s', (zone) => {
    expect(timeZoneSchema.safeParse(zone).success).toBe(true);
  });

  it.each(['Mars/Olympus', ''])('rejects %j', (zone) => {
    expect(timeZoneSchema.safeParse(zone).success).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(timeZoneSchema.safeParse(1).success).toBe(false);
  });
});

describe('household input schemas', () => {
  it('creates with a trimmed name and a valid zone', () => {
    expect(
      householdCreateSchema.safeParse({ name: ' Home ', timezone: 'Europe/Berlin' }).data,
    ).toEqual({ name: 'Home', timezone: 'Europe/Berlin' });
    expect(householdCreateSchema.safeParse({ name: 'Home' }).success).toBe(false);
    expect(householdCreateSchema.safeParse({ name: 'Home', timezone: 'x/y' }).success).toBe(false);
  });

  it('updates partially', () => {
    expect(householdUpdateSchema.safeParse({}).success).toBe(true);
    expect(householdUpdateSchema.safeParse({ name: 'New' }).success).toBe(true);
    expect(householdUpdateSchema.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false);
  });

  it('selects the current household by id', () => {
    expect(currentHouseholdUpdateSchema.safeParse({ householdId: 'h1' }).success).toBe(true);
    expect(currentHouseholdUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe('members', () => {
  const member = {
    userId: 'u1',
    displayName: 'Till',
    email: 'till@example.org',
    role: 'owner',
    joinedAt: '2026-10-13T10:00:00.000Z',
  };

  it('accepts a member and rejects an unknown role', () => {
    expect(memberSchema.safeParse(member).success).toBe(true);
    expect(memberSchema.safeParse({ ...member, role: 'admin' }).success).toBe(false);
  });

  it('updates a role', () => {
    expect(memberRoleUpdateSchema.safeParse({ role: 'viewer' }).success).toBe(true);
    expect(memberRoleUpdateSchema.safeParse({ role: 'root' }).success).toBe(false);
  });
});

describe('invitations', () => {
  const invitation = {
    id: 'i1',
    email: 'guest@example.org',
    role: 'member',
    invitedByName: 'Till',
    createdAt: '2026-10-13T10:00:00.000Z',
    expiresAt: '2026-10-20T10:00:00.000Z',
  };

  it('normalizes the invited e-mail on create', () => {
    expect(
      invitationCreateSchema.safeParse({ email: ' Guest@Example.ORG ', role: 'viewer' }).data,
    ).toEqual({ email: 'guest@example.org', role: 'viewer' });
    expect(invitationCreateSchema.safeParse({ email: 'nope', role: 'viewer' }).success).toBe(false);
  });

  it('describes an invitation and its creation result', () => {
    expect(invitationSchema.safeParse(invitation).success).toBe(true);
    expect(
      invitationCreatedSchema.safeParse({ invitation, link: 'https://example.org/i/t' }).success,
    ).toBe(true);
    expect(invitationCreatedSchema.safeParse({ invitation }).success).toBe(false);
  });

  it('previews an invitation', () => {
    expect(
      invitationPreviewSchema.safeParse({
        householdName: 'Home',
        role: 'member',
        email: 'guest@example.org',
        invitedByName: 'Till',
        accountExists: false,
      }).success,
    ).toBe(true);
  });

  it('takes the token from the body: non-empty, at most 100 characters', () => {
    expect(invitationTokenSchema.safeParse({ token: 'abc' }).success).toBe(true);
    expect(invitationTokenSchema.safeParse({ token: '' }).success).toBe(false);
    expect(invitationTokenSchema.safeParse({ token: 'x'.repeat(101) }).success).toBe(false);
    expect(invitationTokenSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a new account with token, name and language', () => {
    expect(
      invitationAcceptNewSchema.safeParse({ token: 't', displayName: ' Gast ', locale: 'en' }).data,
    ).toEqual({ token: 't', displayName: 'Gast', locale: 'en' });
    expect(
      invitationAcceptNewSchema.safeParse({ token: 't', displayName: 'Gast', locale: 'fr' })
        .success,
    ).toBe(false);
    expect(invitationAcceptNewSchema.safeParse({ displayName: 'Gast', locale: 'en' }).success).toBe(
      false,
    );
  });
});

describe('instanceAppearanceUpdateSchema', () => {
  it('accepts an appearance or null (reset)', () => {
    expect(
      instanceAppearanceUpdateSchema.safeParse({ appearance: DEFAULT_INSTANCE_APPEARANCE }).success,
    ).toBe(true);
    expect(instanceAppearanceUpdateSchema.safeParse({ appearance: null }).success).toBe(true);
    expect(instanceAppearanceUpdateSchema.safeParse({}).success).toBe(false);
  });
});
