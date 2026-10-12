import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiButton, UiEmptyState, UiEmptyStateActions, UiPage } from '@smart/ui';

/** Shown for every route no page claims. */
@Component({
  selector: 'app-not-found',
  imports: [TranslocoPipe, UiButton, UiEmptyState, UiEmptyStateActions, UiPage],
  template: `
    <ui-page [heading]="'app.notFound.title' | transloco">
      <ui-empty-state
        icon="search"
        [heading]="'app.notFound.heading' | transloco"
        [description]="'app.notFound.description' | transloco"
      >
        <div uiEmptyStateActions>
          <ui-button route="/">{{ 'app.notFound.home' | transloco }}</ui-button>
        </div>
      </ui-empty-state>
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFound {}
