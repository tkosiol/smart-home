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
import type { Gateway } from '@smart/contracts';
import { UiRelativeTimePipe, UiSection, UiStack } from '@smart/ui';
import { HouseholdContext, injectHouseholdErrorHandler, LoadedList } from '../../core/household';
import { isNetworkFailure, refreshWhileVisible } from '../../core/refresh';
import { GatewayStatusText } from './gateway-status';
import { GatewaysApi } from './gateways.api';
import { provideGatewaysTexts } from './gateways-texts';

/**
 * The overview's block "Gateway" (owners): status and last message of every registered gateway,
 * kept up to date. Loaded lazily.
 */
@Component({
  selector: 'app-gateway-block',
  imports: [TranslocoPipe, GatewayStatusText, UiRelativeTimePipe, UiSection, UiStack],
  providers: [provideGatewaysTexts()],
  template: `
    <ui-section [heading]="'gateways.block.title' | transloco">
      <ui-stack gap="md">
        @for (gateway of active(); track gateway.id) {
          <ui-section [level]="3" [heading]="gateway.name">
            <ui-stack gap="sm">
              <ui-stack direction="row" gap="lg" wrap>
                <app-gateway-status
                  [label]="'gateways.entry.bridge' | transloco"
                  [status]="gateway.bridgeStatus"
                />
                <app-gateway-status
                  [label]="'gateways.entry.z2m' | transloco"
                  [status]="gateway.z2mStatus"
                />
              </ui-stack>
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
            </ui-stack>
          </ui-section>
        } @empty {
          @if (gateways.loaded()) {
            <p>{{ 'gateways.block.empty' | transloco }}</p>
          }
        }
      </ui-stack>
    </ui-section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GatewayBlock {
  private readonly household = inject(HouseholdContext);
  private readonly api = inject(GatewaysApi);
  private readonly handleError = injectHouseholdErrorHandler();
  private readonly currentId = computed(() => this.household.current()?.id);
  private refreshing = false;

  protected readonly gateways = new LoadedList<Gateway>(
    (id) => this.api.list(id),
    (error) => {
      if (!(this.refreshing && isNetworkFailure(error))) this.handleError(error);
    },
  );
  /** A revoked gateway no longer reports: the block leaves it out. */
  protected readonly active = computed(() =>
    this.gateways.items().filter((gateway) => gateway.revokedAt === null),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.gateways.dispose());
    // Keyed on the id, not on the household object.
    effect(() => {
      const id = this.currentId();
      untracked(() => void this.gateways.load(id));
    });
    refreshWhileVisible(() => {
      this.refreshing = true;
      void this.gateways.load(this.currentId(), true).finally(() => (this.refreshing = false));
    });
  }
}
