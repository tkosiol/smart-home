import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type {
  Invitation,
  InvitationAcceptNew,
  InvitationCreate,
  InvitationCreated,
  InvitationPreview,
} from '@smart/contracts';
import { ENV, type Env } from '../../platform/config/index.js';
import { describeError } from '../../platform/errors/index.js';
import { ApiError } from '../../platform/http/index.js';
import { invitation as invitationMail, MAIL_SENDER, maskEmail } from '../../platform/mail/index.js';
import type { MailSender } from '../../platform/mail/index.js';
import {
  CLOCK,
  newToken,
  sha256,
  UsersRepository,
  type Clock,
  type User,
} from '../identity/index.js';
import type { Membership } from './households.schema.js';
import { HouseholdsRepository } from './households.repository.js';
import { InvitationsRepository } from './invitations.repository.js';
import type { InvitationRow } from './invitations.schema.js';
import { isUuid } from './is-uuid.js';
import { MembershipsRepository } from './memberships.repository.js';

const DAY_MS = 86_400_000;
const INVITATION_VALID_MS = 7 * DAY_MS;

const toInvitation = (row: InvitationRow, invitedByName: string): Invitation => ({
  id: row.id,
  email: row.email,
  role: row.role,
  invitedByName,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
});

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly invitations: InvitationsRepository,
    private readonly users: UsersRepository,
    private readonly households: HouseholdsRepository,
    private readonly memberships: MembershipsRepository,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(householdId: string): Promise<Invitation[]> {
    const rows = await this.invitations.listOpen(householdId, this.clock());
    return rows.map(({ invitedByName, ...row }) => toInvitation(row, invitedByName));
  }

  /** Revokes an open invitation for the same address, stores a new one and mails the link. */
  async create(caller: Membership, input: InvitationCreate): Promise<InvitationCreated> {
    const inviter = await this.userOf(caller.userId);
    const existing = await this.users.findByEmail(input.email);
    if (existing && (await this.memberships.find(caller.householdId, existing.id))) {
      throw new ApiError(HttpStatus.CONFLICT, 'invitation.alreadyMember');
    }
    const now = this.clock();
    const token = newToken();
    const row = await this.invitations.replaceOpen({
      householdId: caller.householdId,
      email: input.email,
      role: input.role,
      tokenHash: sha256(token),
      invitedBy: inviter.id,
      now,
      expiresAt: new Date(now.getTime() + INVITATION_VALID_MS),
    });
    return this.deliver(row, token, inviter);
  }

  /** A new token and a new week for an invitation that was not accepted or revoked. */
  async resend(caller: Membership, invitationId: string): Promise<InvitationCreated> {
    // Unknown, malformed and foreign ids answer alike.
    if (!isUuid(invitationId)) throw new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');
    const inviter = await this.userOf(caller.userId);
    const token = newToken();
    const row = await this.invitations.reissue(caller.householdId, invitationId.toLowerCase(), {
      tokenHash: sha256(token),
      invitedBy: inviter.id,
      expiresAt: new Date(this.clock().getTime() + INVITATION_VALID_MS),
    });
    if (!row) throw new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');
    return this.deliver(row, token, inviter);
  }

  async revoke(caller: Membership, invitationId: string): Promise<void> {
    const revoked = isUuid(invitationId)
      ? await this.invitations.revoke(caller.householdId, invitationId.toLowerCase(), this.clock())
      : false;
    if (!revoked) throw new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');
  }

  /** What the link shows before anybody signs in; the holder of the token knows the address. */
  async preview(token: string): Promise<InvitationPreview> {
    const invitation = await this.open(token);
    const [household, inviter, account] = await Promise.all([
      this.households.findById(invitation.householdId),
      this.users.findById(invitation.invitedBy),
      this.users.findByEmail(invitation.email),
    ]);
    if (!household || !inviter) throw new ApiError(HttpStatus.NOT_FOUND, 'invitation.invalid');
    return {
      householdName: household.name,
      role: invitation.role,
      email: invitation.email,
      invitedByName: inviter.displayName,
      accountExists: account !== undefined,
    };
  }

  /** Accepts for the signed-in user, who must own the invited address. Returns the fresh user. */
  async accept(token: string, userId: string): Promise<User> {
    const invitation = await this.open(token);
    const user = await this.users.findById(userId);
    if (!user) throw new ApiError(HttpStatus.UNAUTHORIZED, 'auth.required');
    if (user.email !== invitation.email) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'invitation.emailMismatch');
    }
    await this.invitations.acceptForUser(invitation, user.id, this.clock());
    return (await this.users.findById(user.id)) ?? user;
  }

  /** Creates the account of the invited address; the caller then starts the session. */
  async acceptNew(token: string, input: InvitationAcceptNew): Promise<User> {
    const invitation = await this.open(token);
    // No look-up of the address first: the unique e-mail inside the transaction decides, so a race
    // cannot end in two accounts and the answer does not depend on timing.
    return this.invitations.acceptWithNewUser(invitation, input, this.clock());
  }

  /** An invitation that can still be accepted, or `invitation.invalid` – one answer for every reason. */
  private async open(token: string): Promise<InvitationRow> {
    const invitation = await this.invitations.findByTokenHash(sha256(token));
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= this.clock()
    ) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'invitation.invalid');
    }
    return invitation;
  }

  private async userOf(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) throw new ApiError(HttpStatus.UNAUTHORIZED, 'auth.required');
    return user;
  }

  /** Mails the link without waiting for it; without mail the link in the answer is all there is. */
  private async deliver(
    row: InvitationRow,
    token: string,
    inviter: User,
  ): Promise<InvitationCreated> {
    const link = `${this.env.APP_ORIGIN}/einladung/${token}`;
    if (this.mail.enabled) {
      const household = await this.households.findById(row.householdId);
      const send = async (): Promise<void> =>
        this.mail.send({
          to: row.email,
          ...invitationMail(inviter.locale, {
            householdName: household?.name ?? '',
            inviterName: inviter.displayName,
            link,
          }),
        });
      // Failures are logged without the error itself, which may quote the address or the link.
      void send().catch((error: unknown) => {
        this.logger.error(
          `Invitation mail to ${maskEmail(row.email)} failed: ${describeError(error)}`,
        );
      });
    }
    return { invitation: toInvitation(row, inviter.displayName), link };
  }
}
