import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import { emailSchema, type HouseholdRole, type InvitationCreated } from '@smart/contracts';
import { UiBanner, UiButton, UiSnackbar, UiStack } from '@smart/ui';
import { UiTextField } from '@smart/ui/forms';
import { ApiError, injectShowApiError } from '../../core/api';
import { HouseholdContext } from '../../core/household';
import { injectHouseholdErrorHandler } from './household-errors';
import { MembersApi } from './members.api';
import { RoleSelect } from './role-select';

/** In the root translation: the keys are looked up in code, where the scope's keys are not found. */
const LINK_COPIED_KEY = marker('app.members.linkCopied');
const ALREADY_MEMBER_KEY = marker('app.errors.invitation.alreadyMember');

/** Writes text to the clipboard; null where the browser has no clipboard API. Tests replace it. */
export const WRITE_CLIPBOARD = new InjectionToken<((text: string) => Promise<void>) | null>(
  'WRITE_CLIPBOARD',
  {
    providedIn: 'root',
    factory: () => {
      const clipboard = globalThis.navigator?.clipboard;
      return clipboard?.writeText ? (text) => clipboard.writeText(text) : null;
    },
  },
);

type EmailError = 'format' | 'alreadyMember' | null;

/**
 * Invites a person by e-mail. The link of a new (or re-sent) invitation is passed in as `link`
 * and shown once with a copy button; without the clipboard API it stays selectable.
 */
@Component({
  selector: 'app-invite-form',
  imports: [TranslocoPipe, RoleSelect, UiBanner, UiButton, UiStack, UiTextField],
  template: `
    <ui-stack gap="lg">
      <form (submit)="invite($event)" novalidate>
        <ui-stack gap="lg">
          <ui-text-field
            name="email"
            type="email"
            autocomplete="off"
            required
            [label]="'households.invite.email' | transloco"
            [error]="
              emailError() === 'format'
                ? ('households.invite.emailError' | transloco)
                : emailError() === 'alreadyMember'
                  ? alreadyMemberText()
                  : null
            "
            [(value)]="email"
          />
          <app-role-select [label]="'households.invite.role' | transloco" [(value)]="role" />
          <ui-stack direction="row" gap="sm">
            <ui-button type="submit" [disabled]="busy()">{{
              'households.invite.send' | transloco
            }}</ui-button>
          </ui-stack>
        </ui-stack>
      </form>
      @if (link(); as link) {
        <ui-stack gap="md">
          <ui-banner tone="info">{{ 'households.invite.linkHint' | transloco }}</ui-banner>
          <input
            #linkField
            readonly
            type="text"
            [value]="link"
            [attr.aria-label]="'households.invite.linkLabel' | transloco"
            (focus)="linkField.select()"
          />
          @if (canCopy) {
            <ui-stack direction="row" gap="sm">
              <ui-button variant="tonal" icon="content_copy" (pressed)="copy(link)">{{
                'households.invite.copy' | transloco
              }}</ui-button>
            </ui-stack>
          }
        </ui-stack>
      }
    </ui-stack>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InviteForm {
  private readonly api = inject(MembersApi);
  private readonly household = inject(HouseholdContext);
  private readonly snackbar = inject(UiSnackbar);
  private readonly transloco = inject(TranslocoService);
  private readonly writeClipboard = inject(WRITE_CLIPBOARD);
  private readonly handleError = injectHouseholdErrorHandler();
  private readonly showError = injectShowApiError();

  readonly link = input<string | null>(null);
  readonly invited = output<InvitationCreated>();

  protected readonly canCopy = this.writeClipboard !== null;
  private readonly currentId = computed(() => this.household.current()?.id);
  // Keyed on the id, not the household object: a reload of the user must not clear what is typed.
  protected readonly email = linkedSignal<string | undefined, string>({
    source: this.currentId,
    computation: () => '',
  });
  protected readonly role = linkedSignal<string | undefined, HouseholdRole | undefined>({
    source: this.currentId,
    computation: () => 'member',
  });
  protected readonly emailError = signal<EmailError>(null);
  protected readonly busy = signal(false);

  protected alreadyMemberText(): string {
    return this.transloco.translate(ALREADY_MEMBER_KEY);
  }

  protected async invite(event: Event): Promise<void> {
    event.preventDefault();
    const id = this.currentId();
    const role = this.role();
    if (!id || !role || this.busy()) return;
    const email = emailSchema.safeParse(this.email());
    this.emailError.set(email.success ? null : 'format');
    if (!email.success) return;
    this.busy.set(true);
    try {
      const created = await this.api.invite(id, email.data, role);
      // The user may have switched households meanwhile: the link belongs to the one before.
      if (this.currentId() !== id) return;
      this.email.set('');
      this.invited.emit(created);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invitation.alreadyMember') {
        this.emailError.set('alreadyMember');
      } else {
        this.handleError(error);
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async copy(link: string): Promise<void> {
    try {
      await this.writeClipboard?.(link);
      void this.snackbar.show(this.transloco.translate(LINK_COPIED_KEY));
    } catch (error) {
      this.showError(error);
    }
  }
}
