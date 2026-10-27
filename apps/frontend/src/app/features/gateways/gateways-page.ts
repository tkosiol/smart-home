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
import { TranslocoPipe } from '@jsverse/transloco';
import type { Gateway } from '@smart/contracts';
import {
  UiBanner,
  UiButton,
  UiCard,
  UiClock,
  UiDateTimePipe,
  UiEmptyState,
  UiPage,
  UiRelativeTimePipe,
  UiSection,
  UiStack,
  UiStatusChip,
  UiStatusEntry,
} from '@smart/ui';
import { ApiError } from '../../core/api';
import { AuthService } from '../../core/auth';
import { HouseholdContext, injectHouseholdErrorHandler, LoadedList } from '../../core/household';
import { injectLive } from '../../core/live';
import { RefreshGuard } from '../../core/refresh';
import { GATEWAY_TONE, gatewayState, statusKey } from './gateway-status';
import { GatewaysApi } from './gateways.api';
import { GatewayRegisterForm } from './register-form';

/** How long a "really?" question stays open. */
const CONFIRM_MS = 5000;
const DAY_MS = 86_400_000;

/**
 * The gateways of the current household with status and warnings (owners); platform admins also
 * register gateways by their certificate and revoke them. Everything is keyed on the household's
 * id, so a reload of the user (which replaces the household object) leaves the page as it is.
 * Each gateway is an entry with its state in the icon container (spec 3.6); the certificate
 * warnings are chips.
 */
@Component({
  selector: 'app-gateways-page',
  imports: [
    TranslocoPipe,
    GatewayRegisterForm,
    UiBanner,
    UiButton,
    UiCard,
    UiDateTimePipe,
    UiEmptyState,
    UiPage,
    UiRelativeTimePipe,
    UiSection,
    UiStack,
    UiStatusChip,
    UiStatusEntry,
  ],
  template: `
    <ui-page [heading]="'gateways.title' | transloco">
      <ui-stack gap="xl">
        @if (crlExpiring()) {
          <ui-banner tone="warning">{{ 'gateways.warnings.crlExpiring' | transloco }}</ui-banner>
        }
        @if (revokedHint()) {
          <ui-banner tone="info">{{ 'gateways.revokedHint' | transloco }}</ui-banner>
        }
        <ui-section [heading]="'gateways.list.title' | transloco">
          <ui-stack gap="md">
            @for (row of rows(); track row.gateway.id) {
              @let gateway = row.gateway;
              <ui-card variant="low">
                <ui-stack gap="sm">
                  @if (gateway.revokedAt) {
                    <ui-status-entry
                      variant="bare"
                      icon="router"
                      kindTone="offline-container"
                      [title]="gateway.name"
                      [headingLevel]="3"
                      [subtitle]="
                        'gateways.entry.revoked'
                          | transloco: { date: gateway.revokedAt | uiDateTime: 'date' }
                      "
                    />
                  } @else {
                    <ui-status-entry
                      variant="bare"
                      icon="router"
                      [kindTone]="row.tone"
                      [title]="gateway.name"
                      [headingLevel]="3"
                      [subtitle]="
                        'gateways.entry.status'
                          | transloco
                            : {
                                bridge: (statusKey(gateway.bridgeStatus) | transloco),
                                z2m: (statusKey(gateway.z2mStatus) | transloco),
                              }
                      "
                    />
                    <p>
                      @if (gateway.lastMessageAt) {
                        {{
                          'gateways.entry.lastMessage'
                            | transloco: { time: gateway.lastMessageAt | uiRelativeTime }
                        }}
                      } @else {
                        {{ 'gateways.entry.noMessage' | transloco }}
                      }
                    </p>
                    <p>
                      {{
                        'gateways.entry.certExpires'
                          | transloco: { date: gateway.certExpiresAt | uiDateTime: 'date' }
                      }}
                    </p>
                    @if (gateway.warnings.length > 0) {
                      <ui-stack direction="row" gap="sm" wrap>
                        @for (warning of gateway.warnings; track warning) {
                          @switch (warning) {
                            @case ('certExpiring') {
                              @let days = daysLeft(gateway);
                              <ui-status-chip
                                tone="warning"
                                [text]="
                                  days > 1
                                    ? ('gateways.warnings.certExpiring' | transloco: { days: days })
                                    : ('gateways.warnings.certExpiringSoon' | transloco)
                                "
                              />
                            }
                            @case ('certExpired') {
                              <ui-status-chip
                                tone="error"
                                [text]="'gateways.warnings.certExpired' | transloco"
                              />
                            }
                          }
                        }
                      </ui-stack>
                    }
                    @if (isPlatformAdmin()) {
                      <ui-stack direction="row" gap="sm" wrap>
                        <ui-button
                          variant="outlined"
                          [disabled]="busy()"
                          (pressed)="press(gateway.id, () => revoke(gateway.id))"
                          >{{
                            (confirming() === gateway.id
                              ? 'gateways.entry.revokeConfirm'
                              : 'gateways.entry.revoke'
                            ) | transloco
                          }}</ui-button
                        >
                      </ui-stack>
                    }
                  }
                </ui-stack>
              </ui-card>
            } @empty {
              @if (gateways.loaded()) {
                <ui-empty-state
                  icon="router"
                  [level]="3"
                  [heading]="'gateways.empty.title' | transloco"
                  [description]="'gateways.empty.description' | transloco"
                />
              }
            }
          </ui-stack>
        </ui-section>
        @if (isPlatformAdmin()) {
          <ui-section [heading]="'gateways.register.title' | transloco">
            <app-gateway-register-form (registered)="registered()" />
          </ui-section>
        }
      </ui-stack>
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GatewaysPage {
  private readonly auth = inject(AuthService);
  private readonly household = inject(HouseholdContext);
  private readonly api = inject(GatewaysApi);
  private readonly clock = inject(UiClock);
  private readonly handleError = injectHouseholdErrorHandler();
  private confirmTimer?: ReturnType<typeof setTimeout>;

  private readonly currentId = computed(() => this.household.current()?.id);
  protected readonly isPlatformAdmin = computed(() => this.auth.me()?.isPlatformAdmin === true);

  protected readonly statusKey = statusKey;
  private readonly refresh = new RefreshGuard();
  protected readonly gateways = new LoadedList<Gateway>(
    (id) => this.api.list(id),
    this.refresh.quietNetworkFailure((error) => this.handleError(error)),
  );
  protected readonly rows = computed(() =>
    this.gateways
      .items()
      .map((gateway) => ({ gateway, tone: GATEWAY_TONE[gatewayState(gateway)] })),
  );
  /** The certificate revocation list is one for the installation, so it is warned about once. */
  protected readonly crlExpiring = computed(() =>
    this.gateways.items().some((gateway) => gateway.warnings.includes('crlExpiring')),
  );

  protected readonly busy = signal(false);
  /** Shown after a revocation, until the household changes: the server's list is not the broker's. */
  protected readonly revokedHint = linkedSignal<string | undefined, boolean>({
    source: this.currentId,
    computation: () => false,
  });
  /** The id of the gateway whose revoke button waits for its second press. */
  protected readonly confirming = linkedSignal<string | undefined, string | null>({
    source: this.currentId,
    computation: () => null,
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.confirmTimer);
      this.gateways.dispose();
    });
    // Keyed on the id, not on the household object.
    effect(() => {
      const id = this.currentId();
      untracked(() => void this.gateways.load(id));
    });
    injectLive({
      'gateway.status': (gateway) => this.gateways.upsert(gateway),
      resync: () => void this.refresh.run(() => this.gateways.load(this.currentId(), true)),
    });
  }

  /** Whole days until the certificate expires, at least 1 (a part of a day counts as a day). */
  protected daysLeft(gateway: Gateway): number {
    return Math.max(1, Math.ceil((Date.parse(gateway.certExpiresAt) - this.clock.now()) / DAY_MS));
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

  protected async revoke(gatewayId: string): Promise<void> {
    const id = this.householdId();
    await this.api.revoke(id, gatewayId);
    if (this.currentId() === id) this.revokedHint.set(true);
    await this.gateways.load(this.currentId(), true);
  }

  protected registered(): Promise<void> {
    return this.gateways.load(this.currentId(), true);
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
      // Another admin may have acted first: the row this was about is gone, so show the truth.
      if (error instanceof ApiError && error.code === 'household.notFound') {
        void this.gateways.load(this.currentId(), true);
      }
    } finally {
      this.busy.set(false);
    }
  }
}
