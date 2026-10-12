import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiEmptyState, UiPage } from '@smart/ui';

/** What will appear here once rooms/devices exist (spec 2). */
@Component({
  selector: 'app-rooms-page',
  imports: [TranslocoPipe, UiEmptyState, UiPage],
  template: `
    <ui-page [heading]="'rooms.title' | transloco">
      <ui-empty-state
        icon="meeting_room"
        [heading]="'rooms.empty.heading' | transloco"
        [description]="'rooms.empty.description' | transloco"
      />
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoomsPage {}
