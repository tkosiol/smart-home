import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { HouseholdRole, InvitationAcceptNew } from '@smart/contracts';
import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { DATABASE, type DatabaseConnection } from '../../platform/database/index.js';
import { ApiError } from '../../platform/http/index.js';
import { users, type User } from '../identity/index.js';
import { memberships } from './households.schema.js';
import { invitations, type InvitationRow } from './invitations.schema.js';

export interface NewInvitation {
  householdId: string;
  /** Normalized. */
  email: string;
  role: HouseholdRole;
  tokenHash: string;
  invitedBy: string;
  now: Date;
  expiresAt: Date;
}

export interface OpenInvitation extends InvitationRow {
  invitedByName: string;
}

/** Not accepted, not revoked: the rows `accept` may still claim (expiry is checked with a clock). */
const unused = and(isNull(invitations.acceptedAt), isNull(invitations.revokedAt));

@Injectable()
export class InvitationsRepository {
  constructor(@Inject(DATABASE) private readonly connection: DatabaseConnection) {}

  /** Stores the invitation and revokes every other unused one for the same address. */
  async replaceOpen(input: NewInvitation): Promise<InvitationRow> {
    const { now, ...values } = input;
    return this.connection.db.transaction(async (tx) => {
      await tx
        .update(invitations)
        .set({ revokedAt: now })
        .where(
          and(
            eq(invitations.householdId, input.householdId),
            eq(invitations.email, input.email),
            unused,
          ),
        );
      const [row] = await tx
        .insert(invitations)
        .values({ ...values, createdAt: now })
        .returning();
      if (!row) throw new Error('Inserting an invitation returned no row');
      return row;
    });
  }

  /** The invitations a member can still accept, newest first. */
  async listOpen(householdId: string, now: Date): Promise<OpenInvitation[]> {
    const rows = await this.connection.db
      .select({ invitation: invitations, invitedByName: users.displayName })
      .from(invitations)
      .innerJoin(users, eq(users.id, invitations.invitedBy))
      .where(and(eq(invitations.householdId, householdId), unused, gt(invitations.expiresAt, now)))
      .orderBy(desc(invitations.createdAt), invitations.id);
    return rows.map(({ invitation, invitedByName }) => ({ ...invitation, invitedByName }));
  }

  async findByTokenHash(tokenHash: string): Promise<InvitationRow | undefined> {
    const [row] = await this.connection.db
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, tokenHash));
    return row;
  }

  /**
   * Gives an unused invitation of the household (open or expired) a new token and a new lifetime;
   * `invitedBy` becomes the person who sends it now.
   */
  async reissue(
    householdId: string,
    id: string,
    next: Pick<NewInvitation, 'tokenHash' | 'invitedBy' | 'expiresAt'>,
  ): Promise<InvitationRow | undefined> {
    const [row] = await this.connection.db
      .update(invitations)
      .set(next)
      .where(and(eq(invitations.id, id), eq(invitations.householdId, householdId), unused))
      .returning();
    return row;
  }

  /** False when the household has no unused invitation with this id. */
  async revoke(householdId: string, id: string, now: Date): Promise<boolean> {
    const rows = await this.connection.db
      .update(invitations)
      .set({ revokedAt: now })
      .where(and(eq(invitations.id, id), eq(invitations.householdId, householdId), unused))
      .returning({ id: invitations.id });
    return rows.length > 0;
  }

  /**
   * Accepts for an existing account: the membership is added unless there is one (its role stays),
   * and the household becomes the user's current one.
   */
  async acceptForUser(invitation: InvitationRow, userId: string, now: Date): Promise<void> {
    await this.connection.db.transaction(async (tx) => {
      await this.claim(tx, invitation, now);
      await tx
        .insert(memberships)
        .values({ householdId: invitation.householdId, userId, role: invitation.role })
        .onConflictDoNothing();
      await tx
        .update(users)
        .set({ lastHouseholdId: invitation.householdId, updatedAt: sql`now()` })
        .where(eq(users.id, userId));
    });
  }

  /**
   * Creates the account, its membership and marks the invitation accepted in one transaction.
   * `UsersRepository.create` cannot join a transaction, so the user is written here.
   *
   * Two requests for the same invitation: the conditional update lets one claim it, the other gets
   * `invitation.invalid`. Two invitations for one new address: the unique e-mail lets one insert
   * the user, the other gets `invitation.accountExists` and its claim is rolled back.
   */
  async acceptWithNewUser(
    invitation: InvitationRow,
    input: InvitationAcceptNew,
    now: Date,
  ): Promise<User> {
    return this.connection.db.transaction(async (tx) => {
      await this.claim(tx, invitation, now);
      const [user] = await tx
        .insert(users)
        .values({
          email: invitation.email,
          displayName: input.displayName,
          locale: input.locale,
          lastHouseholdId: invitation.householdId,
        })
        .onConflictDoNothing({ target: users.email })
        .returning();
      if (!user) throw new ApiError(HttpStatus.CONFLICT, 'invitation.accountExists');
      await tx.insert(memberships).values({
        householdId: invitation.householdId,
        userId: user.id,
        role: invitation.role,
      });
      return user;
    });
  }

  /** Removes invitations that expired, were revoked or accepted before `cutoff`. */
  async deleteSettledBefore(cutoff: Date): Promise<number> {
    const rows = await this.connection.db
      .delete(invitations)
      .where(
        or(
          lt(invitations.expiresAt, cutoff),
          lt(invitations.revokedAt, cutoff),
          lt(invitations.acceptedAt, cutoff),
        ),
      )
      .returning({ id: invitations.id });
    return rows.length;
  }

  /** Marks the invitation accepted, or fails with `invitation.invalid` when somebody was faster. */
  private async claim(tx: Transaction, invitation: InvitationRow, now: Date): Promise<void> {
    const claimed = await tx
      .update(invitations)
      .set({ acceptedAt: now })
      .where(and(eq(invitations.id, invitation.id), unused, gt(invitations.expiresAt, now)))
      .returning({ id: invitations.id });
    if (claimed.length === 0) throw new ApiError(HttpStatus.NOT_FOUND, 'invitation.invalid');
  }
}

type Transaction = Parameters<Parameters<DatabaseConnection['db']['transaction']>[0]>[0];
