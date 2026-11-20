import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import type { Gateway, GatewayPairing } from '@smart/contracts';
import { UiBanner, UiButton, UiDateTimePipe, UiSnackbar, UiStack, UiValueDisplay } from '@smart/ui';
import { injectShowApiError } from '../../core/api';
import { WRITE_CLIPBOARD } from '../../core/clipboard';
import { injectHouseholdErrorHandler } from '../../core/household';
import { GatewaysApi } from './gateways.api';

/** In the root translation: the key is looked up in code, where the scope's keys are not found. */
const ADDRESS_COPIED_KEY = marker('app.gateways.addressCopied');

const POLL_MS = 5000;
const OPEN_IN_HOME_ASSISTANT =
  'https://my.home-assistant.io/redirect/config_flow_start/?domain=smart_bridge';
const INSTRUCTIONS = 'https://github.com/tkosiol/smart-home-hacs';

/** A code that is shown, with what it is compared with to tell that it was used. */
interface ActiveCode {
  readonly pairing: GatewayPairing;
  readonly expiresAt: number;
  /** The gateways that existed when the code was made: a gateway not among them is the new one. */
  readonly known: ReadonlySet<string>;
  /** The key generation of the gateway being paired again, when the code was made. */
  readonly generation: number | null;
}

/**
 * Pairs Home Assistant with a code: a new gateway, or with `gatewayId` a new key for that one
 * (the code is made as soon as the panel appears). While the code is valid it asks for the
 * gateway list every 5 s; a new gateway, or for a re-pairing one whose key generation went up,
 * ends the wait with "Connected". Nothing is cached: the code only lives here.
 */
@Component({
  selector: 'app-gateway-pairing-panel',
  imports: [TranslocoPipe, UiBanner, UiButton, UiDateTimePipe, UiStack, UiValueDisplay],
  template: `
    <ui-stack gap="md">
      @if (connected(); as name) {
        <ui-banner tone="info">{{ 'gateways.pairing.connected' | transloco: { name } }}</ui-banner>
      }
      @if (expired()) {
        <ui-banner tone="warning">{{ 'gateways.pairing.expired' | transloco }}</ui-banner>
      }
      @if (active(); as code) {
        <ui-banner tone="info">{{ 'gateways.pairing.waiting' | transloco }}</ui-banner>
        <ui-value-display
          size="large"
          [value]="code.pairing.code"
          [label]="
            'gateways.pairing.validUntil'
              | transloco: { time: code.pairing.expiresAt | uiDateTime: 'time' }
          "
        />
        <ui-stack gap="sm">
          <p>{{ 'gateways.pairing.address' | transloco }}</p>
          <ui-stack direction="row" gap="sm" wrap>
            <code>{{ code.pairing.appUrl }}</code>
            @if (canCopy) {
              <ui-button
                variant="tonal"
                icon="content_copy"
                (pressed)="copy(code.pairing.appUrl)"
                >{{ 'gateways.pairing.copy' | transloco }}</ui-button
              >
            }
          </ui-stack>
        </ui-stack>
        <ol>
          <li>{{ 'gateways.pairing.step1' | transloco }}</li>
          <li>{{ 'gateways.pairing.step2' | transloco }}</li>
          <li>{{ 'gateways.pairing.step3' | transloco }}</li>
        </ol>
        <ui-stack direction="row" gap="md" wrap>
          <a [href]="openInHomeAssistant" target="_blank" rel="noopener noreferrer">{{
            'gateways.pairing.open' | transloco
          }}</a>
          <a [href]="instructions" target="_blank" rel="noopener noreferrer">{{
            'gateways.pairing.instructions' | transloco
          }}</a>
        </ui-stack>
      } @else if (showCreate()) {
        <p>{{ 'gateways.pairing.intro' | transloco }}</p>
        <ui-stack direction="row" gap="sm">
          <ui-button [disabled]="busy()" (pressed)="create()">{{
            (expired() ? 'gateways.pairing.createAgain' : 'gateways.pairing.create') | transloco
          }}</ui-button>
        </ui-stack>
      }
    </ui-stack>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GatewayPairingPanel {
  private readonly api = inject(GatewaysApi);
  private readonly transloco = inject(TranslocoService);
  private readonly snackbar = inject(UiSnackbar);
  private readonly writeClipboard = inject(WRITE_CLIPBOARD);
  private readonly handleError = injectHouseholdErrorHandler();
  private readonly showError = injectShowApiError();

  readonly householdId = input.required<string>();
  /** The gateway to pair again; without it the code is for a new gateway. */
  readonly gatewayId = input<string>();
  readonly paired = output<Gateway>();

  protected readonly openInHomeAssistant = OPEN_IN_HOME_ASSISTANT;
  protected readonly instructions = INSTRUCTIONS;
  protected readonly canCopy = this.writeClipboard !== null;
  protected readonly busy = signal(false);

  // Everything is about one household and one target: another one starts over.
  private readonly scope = computed(() => `${this.householdId()}/${this.gatewayId() ?? ''}`);
  protected readonly active = linkedSignal<string, ActiveCode | null>({
    source: this.scope,
    computation: () => null,
  });
  protected readonly connected = linkedSignal<string, string | null>({
    source: this.scope,
    computation: () => null,
  });
  protected readonly expired = linkedSignal<string, boolean>({
    source: this.scope,
    computation: () => false,
  });
  /** Set when the code could not be made, so a re-pairing, which makes its own, can be retried. */
  private readonly failed = linkedSignal<string, boolean>({
    source: this.scope,
    computation: () => false,
  });
  /** A re-pairing starts with its code, so it has no button until that has expired or failed. */
  protected readonly showCreate = computed(
    () => this.gatewayId() === undefined || this.expired() || this.failed(),
  );

  constructor() {
    // The code of a re-pairing is made when the panel appears.
    effect(() => {
      if (this.gatewayId() !== undefined) untracked(() => void this.create());
    });
    effect((onCleanup) => {
      const code = this.active();
      if (!code) return;
      const timer = setInterval(() => void this.check(code), POLL_MS);
      onCleanup(() => clearInterval(timer));
    });
  }

  protected async create(): Promise<void> {
    if (this.busy()) return;
    const scope = this.scope();
    const householdId = this.householdId();
    const gatewayId = this.gatewayId();
    this.busy.set(true);
    try {
      const [pairing, gateways] = await Promise.all([
        this.api.createPairing(householdId, gatewayId),
        this.api.list(householdId),
      ]);
      if (this.scope() !== scope) return;
      this.expired.set(false);
      this.failed.set(false);
      this.connected.set(null);
      this.active.set({
        pairing,
        expiresAt: Date.parse(pairing.expiresAt),
        known: new Set(gateways.map((gateway) => gateway.id)),
        generation:
          gateways.find((gateway) => gateway.id === gatewayId)?.credentialGeneration ?? null,
      });
    } catch (error) {
      if (this.scope() === scope) this.failed.set(true);
      this.handleError(error);
    } finally {
      this.busy.set(false);
    }
  }

  private async check(code: ActiveCode): Promise<void> {
    if (this.active() !== code) return;
    if (Date.now() >= code.expiresAt) {
      this.active.set(null);
      this.expired.set(true);
      return;
    }
    const scope = this.scope();
    try {
      const gateways = await this.api.list(this.householdId());
      if (this.scope() !== scope || this.active() !== code) return;
      const found = gateways.find((gateway) => this.isPaired(gateway, code));
      if (found) {
        this.active.set(null);
        this.connected.set(found.name);
        this.paired.emit(found);
      }
    } catch {
      // A failed poll is not worth a message: the next one tries again, and the code stays.
    }
  }

  private isPaired(gateway: Gateway, code: ActiveCode): boolean {
    if (gateway.revokedAt) return false;
    const target = this.gatewayId();
    if (target === undefined) {
      return gateway.auth === 'credentials' && !code.known.has(gateway.id);
    }
    // The old key keeps working until the code is used, so messages say nothing: the generation does.
    return (
      gateway.id === target &&
      code.generation !== null &&
      gateway.credentialGeneration !== null &&
      gateway.credentialGeneration > code.generation
    );
  }

  protected async copy(address: string): Promise<void> {
    try {
      await this.writeClipboard?.(address);
      void this.snackbar.show(this.transloco.translate(ADDRESS_COPIED_KEY));
    } catch (error) {
      this.showError(error);
    }
  }
}
