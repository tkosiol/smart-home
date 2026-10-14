import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  displayNameSchema,
  invitationPreviewSchema,
  invitationTokenSchema,
  type InvitationPreview,
} from '@smart/contracts';
import { UiBanner, UiButton, UiPage, UiStack } from '@smart/ui';
import { UiTextField } from '@smart/ui/forms';
import { API_BASE, ApiClient, ApiError, injectShowApiError } from '../../core/api';
import type { ApiRequestInit } from '../../core/api';
import { AuthService } from '../../core/auth';
import { LanguageService } from '../../core/i18n';
import { InvitationToken } from './invitation-token';

/** The token travels in the request body; the Referer header must not give the page away either. */
const NO_REFERRER: ApiRequestInit = { referrerPolicy: 'no-referrer' };
const API = `${API_BASE}/invitations`;
/** After signing in the sign-in page leads back here; the token waits in `InvitationToken`. */
const INVITATION_PATH = '/einladung';

const normalize = (email: string): string => email.trim().toLowerCase();

/** `failed`: the server could not be asked (retry); `invalid`: unknown, expired, revoked or used. */
type View = 'loading' | 'ready' | 'invalid' | 'failed';

/**
 * Answers an invitation: signed in, with a click; signed out with an account, by signing in with
 * the invited address; signed out without one, by naming oneself. The page stands outside the
 * shell, so it brings its own `main` landmark. The token is read from `InvitationToken` (see
 * there and the routes for why it is not in the address) and never shown or logged.
 */
@Component({
  selector: 'app-invitation-page',
  imports: [TranslocoPipe, UiBanner, UiButton, UiPage, UiStack, UiTextField],
  template: `
    @let invitation = preview();
    @let role = invitation?.role;
    <main>
      <ui-page
        [heading]="'invitation.title' | transloco"
        [description]="
          invitation && view() === 'ready'
            ? ('invitation.summary'
              | transloco
                : {
                    inviter: invitation.invitedByName,
                    household: invitation.householdName,
                    role:
                      role === 'owner'
                        ? ('invitation.roles.owner' | transloco)
                        : role === 'member'
                          ? ('invitation.roles.member' | transloco)
                          : ('invitation.roles.viewer' | transloco),
                  })
            : undefined
        "
      >
        @switch (view()) {
          @case ('invalid') {
            <ui-stack gap="lg">
              <ui-banner tone="warning">{{ 'invitation.invalid.text' | transloco }}</ui-banner>
              <ui-button route="/anmelden">{{ 'invitation.invalid.signIn' | transloco }}</ui-button>
            </ui-stack>
          }
          @case ('failed') {
            <ui-stack gap="lg">
              <ui-banner tone="offline">{{ 'invitation.failed.text' | transloco }}</ui-banner>
              <ui-button (pressed)="load()">{{ 'invitation.failed.retry' | transloco }}</ui-button>
            </ui-stack>
          }
          @case ('ready') {
            @if (invitation) {
              @if (signedIn()) {
                @if (mismatch()) {
                  <ui-stack gap="lg">
                    <ui-banner tone="warning">{{
                      'invitation.mismatch.text' | transloco: { email: invitation.email }
                    }}</ui-banner>
                    <ui-button [disabled]="busy()" (pressed)="switchAccount()">{{
                      (createsAccount()
                        ? 'invitation.mismatch.create'
                        : 'invitation.mismatch.switch'
                      ) | transloco
                    }}</ui-button>
                  </ui-stack>
                } @else {
                  <ui-button [disabled]="busy()" (pressed)="accept()">{{
                    'invitation.accept' | transloco
                  }}</ui-button>
                }
              } @else if (mustSignIn()) {
                <ui-stack gap="lg">
                  <ui-banner tone="info">{{
                    'invitation.signIn.text' | transloco: { email: invitation.email }
                  }}</ui-banner>
                  <ui-button (pressed)="signIn()">{{
                    'invitation.signIn.button' | transloco
                  }}</ui-button>
                </ui-stack>
              } @else {
                <form (submit)="acceptNew($event)" novalidate>
                  <ui-stack gap="lg">
                    <ui-text-field
                      name="displayName"
                      autocomplete="name"
                      required
                      [label]="'invitation.name.label' | transloco"
                      [error]="nameInvalid() ? ('invitation.name.error' | transloco) : null"
                      [(value)]="name"
                    />
                    <ui-button type="submit" [disabled]="busy()">{{
                      'invitation.accept' | transloco
                    }}</ui-button>
                  </ui-stack>
                </form>
              }
            }
          }
        }
      </ui-page>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvitationPage {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly language = inject(LanguageService);
  private readonly tokens = inject(InvitationToken);
  private readonly showError = injectShowApiError();

  protected readonly view = signal<View>('loading');
  protected readonly preview = signal<InvitationPreview | null>(null);
  /** The server said that the invited address has an account after all (409). */
  private readonly accountFound = signal(false);
  /** The server said the signed-in user's address is not the invited one (403): the fallback. */
  private readonly serverMismatch = signal(false);
  protected readonly name = signal('');
  protected readonly nameInvalid = signal(false);
  protected readonly busy = signal(false);

  protected readonly signedIn = computed(() => {
    const status = this.auth.status();
    return status === 'signedIn' || status === 'offline';
  });
  /** Signed in with another address than the invited one, seen without asking the server. */
  private readonly otherAddress = computed(() => {
    const own = this.auth.me()?.email;
    const invited = this.preview()?.email;
    return own !== undefined && invited !== undefined && normalize(own) !== normalize(invited);
  });
  protected readonly mismatch = computed(() => this.serverMismatch() || this.otherAddress());
  /** The invited address has no account yet: the way on is to sign out and name oneself. */
  protected readonly createsAccount = computed(() => this.preview()?.accountExists === false);
  protected readonly mustSignIn = computed(
    () => this.accountFound() || this.preview()?.accountExists === true,
  );

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    const token = this.tokens.get();
    if (token === null || !invitationTokenSchema.safeParse({ token }).success) {
      this.markInvalid();
      return;
    }
    this.view.set('loading');
    // The answer depends on who is signed in.
    await this.auth.ready();
    try {
      const parsed = invitationPreviewSchema.safeParse(
        await this.api.post(`${API}/preview`, { token }, NO_REFERRER),
      );
      if (!parsed.success) throw new ApiError('internal', 200);
      this.preview.set(parsed.data);
      this.view.set('ready');
    } catch (error) {
      if (this.isGone(error)) this.markInvalid();
      else this.view.set('failed');
    }
  }

  protected async accept(): Promise<void> {
    await this.answer('accept', {});
  }

  protected async acceptNew(event: Event): Promise<void> {
    event.preventDefault();
    const name = displayNameSchema.safeParse(this.name());
    this.nameInvalid.set(!name.success);
    if (!name.success) return;
    await this.answer('accept-new', { displayName: name.data, locale: this.language.language() });
  }

  protected signIn(): void {
    void this.router.navigate(['/anmelden'], { queryParams: { ziel: INVITATION_PATH } });
  }

  /**
   * The signed-in user is not the invitee: sign out, then sign in with the invited address, or,
   * without an account (no code would ever be mailed), back here for the name form.
   */
  protected async switchAccount(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.auth.logout();
      if (this.createsAccount()) {
        this.serverMismatch.set(false);
        await this.router.navigateByUrl(INVITATION_PATH);
      } else {
        this.signIn();
      }
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }

  private async answer(
    endpoint: 'accept' | 'accept-new',
    extra: Record<string, unknown>,
  ): Promise<void> {
    const token = this.tokens.get();
    if (this.busy() || token === null) return;
    this.busy.set(true);
    try {
      this.auth.updateMe(
        await this.api.post(`${API}/${endpoint}`, { token, ...extra }, NO_REFERRER),
      );
      this.tokens.clear();
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.handleAnswerError(error);
    } finally {
      this.busy.set(false);
    }
  }

  private handleAnswerError(error: unknown): void {
    if (this.isGone(error)) {
      this.markInvalid();
    } else if (error instanceof ApiError && error.code === 'invitation.emailMismatch') {
      this.serverMismatch.set(true);
    } else if (error instanceof ApiError && error.code === 'invitation.accountExists') {
      this.accountFound.set(true);
    } else {
      this.showError(error);
    }
  }

  /** Unknown, expired, revoked or used (404), or not even a token the server accepts (400). */
  private isGone(error: unknown): boolean {
    return (
      error instanceof ApiError &&
      (error.code === 'invitation.invalid' || error.code === 'validation.failed')
    );
  }

  private markInvalid(): void {
    this.tokens.clear();
    this.view.set('invalid');
  }
}
