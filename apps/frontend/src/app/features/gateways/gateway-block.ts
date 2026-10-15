import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Gateway, GatewayStatus } from '@smart/contracts';
import { UiRelativeTimePipe, UiStack, UiStatusEntry, type UiStatusEntryTone } from '@smart/ui';
import { HouseholdContext, injectHouseholdErrorHandler, LoadedList } from '../../core/household';
import { RefreshGuard, refreshWhileVisible } from '../../core/refresh';
import { GatewaysApi } from './gateways.api';
import { provideGatewaysTexts } from './gateways-texts';

/**
 * One state for the row: online only while bridge and Zigbee2MQTT both are (the backend counts
 * the gateway as offline otherwise); unknown when nothing says offline but one of them is unknown.
 */
function stateOf(gateway: Gateway): GatewayStatus {
  const statuses = [gateway.bridgeStatus, gateway.z2mStatus];
  if (statuses.every((status) => status === 'online')) return 'online';
  return statuses.includes('offline') ? 'offline' : 'unknown';
}

/** The icon container per state (spec 3.6): online ok, offline the strong error, unknown grey. */
const TONE: Record<GatewayStatus, UiStatusEntryTone> = {
  online: 'ok-container',
  offline: 'error',
  unknown: 'offline-container',
};

/**
 * The overview's block "Gateway" (owners): one row per registered gateway in the style of the
 * hero's calm row, with its state in the icon container and in words, and its last message as
 * relative time; the row leads to the gateways page. Kept up to date, loaded lazily.
 */
@Component({
  selector: 'app-gateway-block',
  imports: [TranslocoPipe, UiRelativeTimePipe, UiStack, UiStatusEntry],
  providers: [provideGatewaysTexts()],
  template: `
    <ui-stack gap="sm">
      @for (row of rows(); track row.gateway.id) {
        <ui-status-entry
          variant="row"
          icon="router"
          [kindTone]="row.tone"
          [title]="row.gateway.name"
          [subtitle]="
            'gateways.block.subtitle'
              | transloco
                : {
                    state:
                      row.state === 'online'
                        ? ('gateways.block.online' | transloco)
                        : row.state === 'offline'
                          ? ('gateways.block.offline' | transloco)
                          : ('gateways.block.unknown' | transloco),
                    message: row.gateway.lastMessageAt
                      ? ('gateways.entry.lastMessage'
                        | transloco: { time: row.gateway.lastMessageAt | uiRelativeTime })
                      : ('gateways.entry.noMessage' | transloco),
                  }
          "
          route="/mehr/gateways"
        />
      } @empty {
        @if (gateways.loaded()) {
          <p>{{ 'gateways.block.empty' | transloco }}</p>
        }
      }
    </ui-stack>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GatewayBlock {
  private readonly household = inject(HouseholdContext);
  private readonly api = inject(GatewaysApi);
  private readonly handleError = injectHouseholdErrorHandler();
  private readonly currentId = computed(() => this.household.current()?.id);
  private readonly refresh = new RefreshGuard();

  protected readonly gateways = new LoadedList<Gateway>(
    (id) => this.api.list(id),
    this.refresh.quietNetworkFailure((error) => this.handleError(error)),
  );
  /** A revoked gateway no longer reports: the block leaves it out. */
  protected readonly rows = computed(() =>
    this.gateways
      .items()
      .filter((gateway) => gateway.revokedAt === null)
      .map((gateway) => {
        const state = stateOf(gateway);
        return { gateway, state, tone: TONE[state] };
      }),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.gateways.dispose());
    // Keyed on the id, not on the household object.
    effect(() => {
      const id = this.currentId();
      untracked(() => void this.gateways.load(id));
    });
    refreshWhileVisible(this.refresh, () => this.gateways.load(this.currentId(), true));
  }
}
