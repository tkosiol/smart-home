import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiEmptyState, UiGrid, UiPage } from '@smart/ui';
import { injectOverviewCards } from '../../core/features';

/** The overview: cards other features registered, or an explanation while there are none. */
@Component({
  selector: 'app-dashboard-page',
  imports: [NgComponentOutlet, TranslocoPipe, UiEmptyState, UiGrid, UiPage],
  template: `
    <ui-page [heading]="'dashboard.title' | transloco">
      @if (cards.length > 0) {
        <ui-grid>
          @for (card of cards; track card) {
            <ng-container [ngComponentOutlet]="card" />
          }
        </ui-grid>
      } @else {
        <ui-empty-state
          icon="home"
          [heading]="'dashboard.empty.heading' | transloco"
          [description]="'dashboard.empty.description' | transloco"
        />
      }
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {
  protected readonly cards = injectOverviewCards();
}
