import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiList, UiListItem, UiPage } from '@smart/ui';
import { injectMoreEntries } from '../../core/features';
import { COMING_SOON_ENTRIES } from './coming-soon-entries';

/** Everything beyond the four main destinations: registered entries plus what is still to come. */
@Component({
  selector: 'app-more-page',
  imports: [TranslocoPipe, UiList, UiListItem, UiPage],
  template: `
    <ui-page [heading]="'more.title' | transloco">
      <ui-list>
        @for (entry of entries; track entry.id) {
          <ui-list-item
            [headline]="entry.labelKey | transloco"
            [icon]="entry.icon"
            [route]="entry.route"
            [supporting]="entry.route ? undefined : ('more.comingSoon' | transloco)"
          />
        }
      </ui-list>
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MorePage {
  protected readonly entries = [...COMING_SOON_ENTRIES, ...injectMoreEntries()].sort(
    (a, b) => a.order - b.order,
  );
}
