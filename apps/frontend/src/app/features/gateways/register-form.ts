import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import { gatewayRegisterSchema } from '@smart/contracts';
import { UiButton, UiStack } from '@smart/ui';
import { UiTextField } from '@smart/ui/forms';
import { ApiError } from '../../core/api';
import { HouseholdContext, injectHouseholdErrorHandler } from '../../core/household';
import { GatewaysApi } from './gateways.api';

/** In the root translation: the keys are looked up in code, where the scope's keys are not found. */
const CERTIFICATE_ERROR_KEYS = {
  'gateway.invalidCertificate': marker('app.errors.gateway.invalidCertificate'),
  'gateway.exists': marker('app.errors.gateway.exists'),
  'gateway.caMissing': marker('app.errors.gateway.caMissing'),
} as const;

type ServerError = keyof typeof CERTIFICATE_ERROR_KEYS;
type CertificateError = ServerError | 'empty';

function isCertificateError(code: string): code is ServerError {
  return Object.hasOwn(CERTIFICATE_ERROR_KEYS, code);
}

/**
 * Registers a gateway by its name and the pasted certificate (PEM). The server's refusals of the
 * certificate are shown next to its field; everything else goes through the household handler.
 */
@Component({
  selector: 'app-gateway-register-form',
  imports: [TranslocoPipe, UiButton, UiStack, UiTextField],
  template: `
    <form (submit)="register($event)" novalidate>
      <ui-stack gap="lg">
        <ui-text-field
          name="name"
          autocomplete="off"
          required
          [label]="'gateways.register.name' | transloco"
          [error]="nameInvalid() ? ('gateways.register.nameError' | transloco) : null"
          [(value)]="name"
        />
        <ui-text-field
          name="certificate"
          multiline
          [rows]="8"
          autocomplete="off"
          required
          [label]="'gateways.register.certificate' | transloco"
          [hint]="'gateways.register.certificateHint' | transloco"
          [error]="
            certificateError() === 'empty'
              ? ('gateways.register.certificateError' | transloco)
              : serverMessage()
          "
          [(value)]="certificate"
        />
        <ui-stack direction="row" gap="sm">
          <ui-button type="submit" [disabled]="busy()">{{
            'gateways.register.submit' | transloco
          }}</ui-button>
        </ui-stack>
      </ui-stack>
    </form>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GatewayRegisterForm {
  private readonly api = inject(GatewaysApi);
  private readonly household = inject(HouseholdContext);
  private readonly transloco = inject(TranslocoService);
  private readonly handleError = injectHouseholdErrorHandler();

  readonly registered = output();

  private readonly currentId = computed(() => this.household.current()?.id);
  // Keyed on the id, not the household object: a reload of the user must not clear what is typed.
  protected readonly name = linkedSignal<string | undefined, string>({
    source: this.currentId,
    computation: () => '',
  });
  protected readonly certificate = linkedSignal<string | undefined, string>({
    source: this.currentId,
    computation: () => '',
  });
  protected readonly nameInvalid = linkedSignal<readonly unknown[], boolean>({
    source: () => [this.currentId(), this.name()],
    computation: () => false,
  });
  // A message is about what was sent: another certificate, or another household, clears it.
  protected readonly certificateError = linkedSignal<readonly unknown[], CertificateError | null>({
    source: () => [this.currentId(), this.certificate()],
    computation: () => null,
  });
  protected readonly busy = signal(false);

  /** The server's refusal of the certificate, in the page language (a method: re-read on each check). */
  protected serverMessage(): string | null {
    const error = this.certificateError();
    return error === null || error === 'empty'
      ? null
      : this.transloco.translate(CERTIFICATE_ERROR_KEYS[error]);
  }

  protected async register(event: Event): Promise<void> {
    event.preventDefault();
    const id = this.currentId();
    if (!id || this.busy()) return;
    const parsed = gatewayRegisterSchema.safeParse({
      name: this.name(),
      certificate: this.certificate(),
    });
    const failed = new Set(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path[0]));
    this.nameInvalid.set(failed.has('name'));
    this.certificateError.set(failed.has('certificate') ? 'empty' : null);
    if (!parsed.success) return;
    this.busy.set(true);
    try {
      await this.api.register(id, parsed.data);
      // The user may have switched households meanwhile: the gateway belongs to the one before.
      if (this.currentId() !== id) return;
      this.name.set('');
      this.certificate.set('');
      this.registered.emit();
    } catch (error) {
      if (error instanceof ApiError && isCertificateError(error.code)) {
        if (this.currentId() === id) this.certificateError.set(error.code);
      } else {
        this.handleError(error);
      }
    } finally {
      this.busy.set(false);
    }
  }
}
