import { Injectable, inject } from '@angular/core';
import type { HouseholdRole, Invitation, InvitationCreated, Member } from '@smart/contracts';
import { API_BASE, ApiClient } from '../../core/api';

/** The member and invitation endpoints of one household (the server checks role and membership). */
@Injectable({ providedIn: 'root' })
export class MembersApi {
  private readonly api = inject(ApiClient);

  private path(householdId: string, rest: string): string {
    return `${API_BASE}/households/${householdId}/${rest}`;
  }

  members(householdId: string): Promise<Member[]> {
    return this.api.get<Member[]>(this.path(householdId, 'members'));
  }

  changeRole(householdId: string, userId: string, role: HouseholdRole): Promise<void> {
    return this.api.patch(this.path(householdId, `members/${userId}`), { role });
  }

  /** Removes a member; for the own user id this is leaving. */
  remove(householdId: string, userId: string): Promise<void> {
    return this.api.delete(this.path(householdId, `members/${userId}`));
  }

  invitations(householdId: string): Promise<Invitation[]> {
    return this.api.get<Invitation[]>(this.path(householdId, 'invitations'));
  }

  invite(householdId: string, email: string, role: HouseholdRole): Promise<InvitationCreated> {
    return this.api.post<InvitationCreated>(this.path(householdId, 'invitations'), { email, role });
  }

  resend(householdId: string, invitationId: string): Promise<InvitationCreated> {
    return this.api.post<InvitationCreated>(
      this.path(householdId, `invitations/${invitationId}/resend`),
    );
  }

  revoke(householdId: string, invitationId: string): Promise<void> {
    return this.api.delete(this.path(householdId, `invitations/${invitationId}`));
  }
}
