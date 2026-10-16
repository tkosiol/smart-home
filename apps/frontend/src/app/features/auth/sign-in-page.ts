import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  effect,
  inject,
  signal,
  untracked,
  type WritableSignal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { emailSchema } from '@smart/contracts';
import { UiBanner, UiButton, UiCard, UiPage, UiStack } from '@smart/ui';
import { UiTextField } from '@smart/ui/forms';
import { ApiError, injectShowApiError } from '../../core/api';
import { AuthService, safeTarget } from '../../core/auth';

/** A new code may be requested this long after the last one (the server allows 3 per 15 minutes). */
const RESEND_AFTER_MS = 60_000;
const CODE_PATTERN = /^\d{6}$/;

type Step = 'email' | 'code';
/** Which text a field shows; the texts are in the scope's translation files. */
type FieldError =
  'format' | 'invalidCode' | 'tooManyAttempts' | 'rateLimited' | 'rateLimitedLater' | null;

/**
 * Sign in with a code sent by e-mail: first the address, then the six digits. Whether an address
 * belongs to an account is never revealed: the code step looks the same for every address. The
 * page stands outside the shell, so it brings its own `main` landmark (the title strategy moves
 * the focus to the heading inside it). The form sits in one card with a full-width primary
 * button (spec 3.6).
 */
@Component({
  selector: 'app-sign-in-page',
  imports: [TranslocoPipe, UiBanner, UiButton, UiCard, UiPage, UiStack, UiTextField],
  template: `
    <main>
      <ui-page
        [heading]="'auth.title' | transloco"
        [description]="
          mailDisabled()
            ? undefined
            : step() === 'email'
              ? ('auth.email.description' | transloco)
              : ('auth.code.description' | transloco: { email: sentTo() })
        "
      >
        <ui-stack gap="lg">
          @if (auth.connectionLost()) {
            <ui-banner tone="offline">{{ 'auth.noConnection' | transloco }}</ui-banner>
          }
          @if (mailDisabled()) {
            <ui-banner tone="warning">{{ 'auth.mailDisabled' | transloco }}</ui-banner>
          } @else if (step() === 'email') {
            <ui-card variant="low">
              <form (submit)="sendCode($event)" novalidate>
                <ui-stack gap="lg">
                  <ui-text-field
                    type="email"
                    name="email"
                    autocomplete="email"
                    inputmode="email"
                    required
                    [label]="'auth.email.label' | transloco"
                    [error]="
                      emailError() === 'format'
                        ? ('auth.errors.email' | transloco)
                        : emailError() === 'rateLimited'
                          ? ('auth.errors.rateLimited' | transloco: { seconds: retryAfter() })
                          : emailError() === 'rateLimitedLater'
                            ? ('auth.errors.rateLimitedLater' | transloco)
                            : null
                    "
                    [(value)]="email"
                  />
                  <ui-button type="submit" fullWidth [disabled]="busy()">{{
                    'auth.email.submit' | transloco
                  }}</ui-button>
                </ui-stack>
              </form>
            </ui-card>
          } @else {
            <ui-card variant="low">
              <form (submit)="verify($event)" novalidate>
                <ui-stack gap="lg">
                  @if (resent()) {
                    <ui-banner tone="info">{{ 'auth.code.resent' | transloco }}</ui-banner>
                  }
                  <ui-text-field
                    name="code"
                    autocomplete="one-time-code"
                    inputmode="numeric"
                    required
                    [label]="'auth.code.label' | transloco"
                    [hint]="resendReady() ? undefined : ('auth.code.resendWait' | transloco)"
                    [error]="
                      codeError() === 'format'
                        ? ('auth.errors.code' | transloco)
                        : codeError() === 'invalidCode'
                          ? ('auth.errors.invalidCode' | transloco)
                          : codeError() === 'tooManyAttempts'
                            ? ('auth.errors.tooManyAttempts' | transloco)
                            : codeError() === 'rateLimited'
                              ? ('auth.errors.rateLimited' | transloco: { seconds: retryAfter() })
                              : codeError() === 'rateLimitedLater'
                                ? ('auth.errors.rateLimitedLater' | transloco)
                                : null
                    "
                    [(value)]="code"
                  />
                  <ui-button type="submit" fullWidth [disabled]="busy()">{{
                    'auth.code.submit' | transloco
                  }}</ui-button>
                  <ui-stack direction="row" gap="sm" wrap>
                    <ui-button
                      variant="text"
                      [disabled]="busy() || !resendReady()"
                      (pressed)="resend()"
                      >{{ 'auth.code.resend' | transloco }}</ui-button
                    >
                    <ui-button variant="text" [disabled]="busy()" (pressed)="changeEmail()">{{
                      'auth.code.otherEmail' | transloco
                    }}</ui-button>
                  </ui-stack>
                </ui-stack>
              </form>
            </ui-card>
          }
        </ui-stack>
      </ui-page>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInPage {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly showError = injectShowApiError();
  private resendTimer?: ReturnType<typeof setTimeout>;

  protected readonly step = signal<Step>('email');
  protected readonly email = signal('');
  /** The normalized address the code went to. */
  protected readonly sentTo = signal('');
  protected readonly code = signal('');
  protected readonly emailError = signal<FieldError>(null);
  protected readonly codeError = signal<FieldError>(null);
  protected readonly retryAfter = signal(0);
  protected readonly busy = signal(false);
  protected readonly mailDisabled = signal(false);
  protected readonly resendReady = signal(false);
  protected readonly resent = signal(false);

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.resendTimer));
    // Someone who is signed in (or comes back online as such) has no business here.
    effect(() => {
      const status = this.auth.status();
      if (status === 'signedIn' || status === 'offline') {
        untracked(() => void this.router.navigateByUrl(this.target()));
      }
    });
    void this.auth.ready();
  }

  protected async sendCode(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    const parsed = emailSchema.safeParse(this.email());
    if (!parsed.success) {
      this.emailError.set('format');
      return;
    }
    this.emailError.set(null);
    if (await this.request(parsed.data, this.emailError)) {
      this.sentTo.set(parsed.data);
      this.code.set('');
      this.codeError.set(null);
      this.resent.set(false);
      this.step.set('code');
      this.focusField('one-time-code');
    }
  }

  protected async resend(): Promise<void> {
    if (this.busy() || !this.resendReady()) return;
    this.codeError.set(null);
    if (await this.request(this.sentTo(), this.codeError)) {
      this.code.set('');
      this.resent.set(true);
      this.focusField('one-time-code');
    }
  }

  protected changeEmail(): void {
    clearTimeout(this.resendTimer);
    this.codeError.set(null);
    this.step.set('email');
    this.focusField('email');
  }

  protected async verify(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    // A code pasted from the mail may carry spaces ("123 456").
    const code = this.code().replace(/\s+/g, '');
    if (!CODE_PATTERN.test(code)) {
      this.codeError.set('format');
      return;
    }
    this.codeError.set(null);
    this.busy.set(true);
    try {
      // The effect above leads on to the target as soon as the user is signed in.
      await this.auth.verifyCode(this.sentTo(), code);
    } catch (error) {
      this.showFieldError(error, this.codeError);
      if (error instanceof ApiError && error.code === 'auth.tooManyAttempts') {
        // The code is used up: a new one is the only way on.
        clearTimeout(this.resendTimer);
        this.resendReady.set(true);
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** Asks for a code and restarts the wait for the next one; false when it did not work. */
  private async request(email: string, field: WritableSignal<FieldError>): Promise<boolean> {
    this.busy.set(true);
    try {
      await this.auth.requestCode(email);
      this.startResendWait();
      return true;
    } catch (error) {
      this.showFieldError(error, field);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private showFieldError(error: unknown, field: WritableSignal<FieldError>): void {
    if (!(error instanceof ApiError)) {
      this.showError(error);
      return;
    }
    switch (error.code) {
      case 'auth.mailDisabled':
        this.mailDisabled.set(true);
        break;
      case 'auth.invalidCode':
        field.set('invalidCode');
        break;
      case 'auth.tooManyAttempts':
        field.set('tooManyAttempts');
        break;
      case 'auth.rateLimited': {
        const seconds = Number(error.params?.['retryAfterSeconds']);
        this.retryAfter.set(Number.isFinite(seconds) ? Math.max(1, Math.ceil(seconds)) : 0);
        field.set(this.retryAfter() > 0 ? 'rateLimited' : 'rateLimitedLater');
        break;
      }
      default:
        this.showError(error);
    }
  }

  private startResendWait(): void {
    clearTimeout(this.resendTimer);
    this.resendReady.set(false);
    this.resendTimer = setTimeout(() => this.resendReady.set(true), RESEND_AFTER_MS);
  }

  /** Only paths inside this app; anything else (an open redirect) leads to the start page. */
  private target(): string {
    return safeTarget(this.route.snapshot.queryParamMap.get('ziel'));
  }

  private focusField(autocomplete: 'email' | 'one-time-code'): void {
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLInputElement>(`input[autocomplete="${autocomplete}"]`)
          ?.focus(),
      { injector: this.injector },
    );
  }
}
