import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { HouseholdRole, Invitation, InvitationCreated, Member } from '@smart/contracts';
import { UiButton, UiDateTimePipe, UiPage, UiSection, UiStack } from '@smart/ui';
import { AuthService } from '../../core/auth';
import { HouseholdContext } from '../../core/household';
import { injectHouseholdErrorHandler } from './household-errors';
import { InviteForm } from './invite-form';
import { MembersApi } from './members.api';
import { RoleSelect } from './role-select';

/** How long a "really?" question stays open. */
const CONFIRM_MS = 5000;

/**
 * A list loaded for a household id; a slower answer to an older request never replaces a newer one.
 * (Not Angular's `resource`: using it from a lazy page enlarges the initial bundle.)
 */
class LoadedList<T> {
  readonly items = signal<readonly T[]>([]);
  /** Whether `items` is the server's answer (not the empty list of a load that has not ended). */
  readonly loaded = signal(false);
  private requests = 0;

  constructor(
    private readonly fetch: (householdId: string) => Promise<T[]>,
    private readonly onError: (error: unknown) => void,
  ) {}

  /** Loads the list of `householdId` (none: empties it); `keep` leaves the old rows while loading. */
  async load(householdId: string | undefined, keep = false): Promise<void> {
    const request = ++this.requests;
    if (!keep) {
      this.items.set([]);
      this.loaded.set(false);
    }
    if (!householdId) return;
    try {
      const items = await this.fetch(householdId);
      if (request === this.requests) {
        this.items.set(items);
        this.loaded.set(true);
      }
    } catch (error) {
      if (request === this.requests) this.onError(error);
    }
  }
}

/**
 * Members of the current household with their roles; owners also manage the open invitations and
 * invite people. Everything is keyed on the household's id, so a reload of the user (which
 * replaces the household object) leaves the page as it is.
 */
@Component({
  selector: 'app-members-page',
  imports: [
    TranslocoPipe,
    InviteForm,
    RoleSelect,
    UiButton,
    UiDateTimePipe,
    UiPage,
    UiSection,
    UiStack,
  ],
  template: `
    <ui-page [heading]="'households.members.title' | transloco">
      <ui-stack gap="xl">
        <ui-section [heading]="'households.members.people' | transloco">
          <ui-stack gap="lg">
            @for (entry of members.items(); track entry.userId + ':' + rev()) {
              @let own = entry.userId === auth.me()?.id;
              @let role =
                entry.role === 'owner'
                  ? ('households.roles.owner' | transloco)
                  : entry.role === 'member'
                    ? ('households.roles.member' | transloco)
                    : ('households.roles.viewer' | transloco);
              <ui-section
                [level]="3"
                [heading]="entry.displayName"
                [description]="
                  'households.members.entry' | transloco: { email: entry.email, role: role }
                "
              >
                @if (own) {
                  <ui-stack direction="row" gap="sm" wrap>
                    <ui-button
                      variant="outlined"
                      [disabled]="busy()"
                      (pressed)="press('leave', () => leave())"
                      >{{
                        (confirming() === 'leave'
                          ? 'households.members.leaveConfirm'
                          : 'households.members.leave'
                        ) | transloco
                      }}</ui-button
                    >
                  </ui-stack>
                } @else if (isOwner()) {
                  <ui-stack direction="row" gap="sm" wrap align="center">
                    <app-role-select
                      [label]="'households.members.role' | transloco"
                      [disabled]="busy()"
                      [value]="entry.role"
                      (valueChange)="changeRole(entry, $event)"
                    />
                    <ui-button
                      variant="outlined"
                      [disabled]="busy()"
                      (pressed)="press('remove:' + entry.userId, () => remove(entry))"
                      >{{
                        (confirming() === 'remove:' + entry.userId
                          ? 'households.members.removeConfirm'
                          : 'households.members.remove'
                        ) | transloco
                      }}</ui-button
                    >
                  </ui-stack>
                }
              </ui-section>
            }
          </ui-stack>
        </ui-section>
        @if (isOwner()) {
          <ui-section [heading]="'households.invitations.title' | transloco">
            <ui-stack gap="lg">
              @for (invitation of invitations.items(); track invitation.id) {
                @let invitedRole =
                  invitation.role === 'owner'
                    ? ('households.roles.owner' | transloco)
                    : invitation.role === 'member'
                      ? ('households.roles.member' | transloco)
                      : ('households.roles.viewer' | transloco);
                <ui-section
                  [level]="3"
                  [heading]="invitation.email"
                  [description]="
                    'households.invitations.entry'
                      | transloco: { role: invitedRole, date: invitation.expiresAt | uiDateTime }
                  "
                >
                  <ui-stack direction="row" gap="sm" wrap>
                    <ui-button
                      variant="tonal"
                      [disabled]="busy()"
                      (pressed)="resend(invitation.id)"
                      >{{ 'households.invitations.resend' | transloco }}</ui-button
                    >
                    <ui-button
                      variant="outlined"
                      [disabled]="busy()"
                      (pressed)="press('revoke:' + invitation.id, () => revoke(invitation.id))"
                      >{{
                        (confirming() === 'revoke:' + invitation.id
                          ? 'households.invitations.revokeConfirm'
                          : 'households.invitations.revoke'
                        ) | transloco
                      }}</ui-button
                    >
                  </ui-stack>
                </ui-section>
              } @empty {
                @if (invitations.loaded()) {
                  {{ 'households.invitations.none' | transloco }}
                }
              }
            </ui-stack>
          </ui-section>
          <ui-section [heading]="'households.invite.title' | transloco">
            <app-invite-form [link]="link()" (invited)="invited($event)" />
          </ui-section>
        }
      </ui-stack>
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MembersPage {
  protected readonly auth = inject(AuthService);
  private readonly household = inject(HouseholdContext);
  private readonly router = inject(Router);
  private readonly api = inject(MembersApi);
  private readonly handleError = injectHouseholdErrorHandler();
  private confirmTimer?: ReturnType<typeof setTimeout>;

  private readonly currentId = computed(() => this.household.current()?.id);
  protected readonly isOwner = computed(() => this.household.current()?.role === 'owner');

  protected readonly members = new LoadedList<Member>(
    (id) => this.api.members(id),
    (error) => this.handleError(error),
  );
  protected readonly invitations = new LoadedList<Invitation>(
    (id) => this.api.invitations(id),
    (error) => this.handleError(error),
  );

  protected readonly busy = signal(false);
  /** Bumped after a refused role change, so the selects show the server's roles again. */
  protected readonly rev = signal(0);
  /** The link of the newest (or re-sent) invitation; shown once, never kept for another household. */
  protected readonly link = linkedSignal<string | undefined, string | null>({
    source: this.currentId,
    computation: () => null,
  });
  /** Which button waits for its second press (`leave`, `remove:<id>`, `revoke:<id>`). */
  protected readonly confirming = linkedSignal<string | undefined, string | null>({
    source: this.currentId,
    computation: () => null,
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.confirmTimer));
    // Keyed on the id (and the owner role for the invitations), not on the household object.
    effect(() => {
      const id = this.currentId();
      untracked(() => void this.members.load(id));
    });
    effect(() => {
      const id = this.isOwner() ? this.currentId() : undefined;
      untracked(() => void this.invitations.load(id));
    });
  }

  /** The first press asks again, the second runs `action`; the question closes after 5 s. */
  protected press(key: string, action: () => Promise<void>): Promise<void> | void {
    if (this.confirming() !== key) {
      this.confirming.set(key);
      clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => this.confirming.set(null), CONFIRM_MS);
      return;
    }
    clearTimeout(this.confirmTimer);
    this.confirming.set(null);
    return this.run(action);
  }

  protected changeRole(entry: Member, role: HouseholdRole | undefined): Promise<void> | void {
    if (!role || role === entry.role) return;
    return this.run(async () => {
      try {
        await this.api.changeRole(this.householdId(), entry.userId, role);
      } catch (error) {
        this.rev.update((count) => count + 1);
        throw error;
      }
      await this.members.load(this.currentId(), true);
    });
  }

  protected async remove(entry: Member): Promise<void> {
    await this.api.remove(this.householdId(), entry.userId);
    await this.members.load(this.currentId(), true);
  }

  /** Leaving: whatever household is left is current after the reload; without one the guards lead on. */
  protected async leave(): Promise<void> {
    const userId = this.auth.me()?.id;
    if (!userId) return;
    await this.api.remove(this.householdId(), userId);
    await this.auth.load();
    await this.router.navigateByUrl('/');
  }

  protected async revoke(invitationId: string): Promise<void> {
    await this.api.revoke(this.householdId(), invitationId);
    await this.invitations.load(this.currentId(), true);
  }

  protected resend(invitationId: string): Promise<void> {
    return this.run(async () => {
      const id = this.householdId();
      const created = await this.api.resend(id, invitationId);
      if (this.currentId() === id) this.link.set(created.link);
      await this.invitations.load(this.currentId(), true);
    });
  }

  protected async invited(created: InvitationCreated): Promise<void> {
    this.link.set(created.link);
    await this.invitations.load(this.currentId(), true);
  }

  private householdId(): string {
    const id = this.currentId();
    if (!id) throw new Error('No current household');
    return id;
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.busy.set(false);
    }
  }
}
