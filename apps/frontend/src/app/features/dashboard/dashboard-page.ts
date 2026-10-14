import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, signal, type Type } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiEmptyState, UiPage, UiStack } from '@smart/ui';
import { injectOverviewCards, resolveOverviewCards } from '../../core/features';

/**
 * The overview: cards other features registered, or an explanation while there are none. A card
 * may be loaded lazily; each card lays itself out (a card may bring a grid of its own).
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [NgComponentOutlet, TranslocoPipe, UiEmptyState, UiPage, UiStack],
  template: `
    <ui-page [heading]="'dashboard.title' | transloco">
      @if (cards(); as cards) {
        @if (cards.length > 0) {
          <ui-stack gap="lg">
            @for (card of cards; track card) {
              <ng-container [ngComponentOutlet]="card" />
            }
          </ui-stack>
        } @else {
          <ui-empty-state
            icon="home"
            [heading]="'dashboard.empty.heading' | transloco"
            [description]="'dashboard.empty.description' | transloco"
          />
        }
      }
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {
  /** Null until the loaders have answered, so the empty state does not flash before a card. */
  protected readonly cards = signal<readonly Type<unknown>[] | null>(null);

  constructor() {
    void resolveOverviewCards(injectOverviewCards()).then((cards) => this.cards.set(cards));
  }
}
