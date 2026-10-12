import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiEmptyState, UiPage } from '@smart/ui';

/** What will appear here once rooms/devices exist (spec 2). */
@Component({
  selector: 'app-devices-page',
  imports: [TranslocoPipe, UiEmptyState, UiPage],
  template: `
    <ui-page [heading]="'devices.title' | transloco">
      <ui-empty-state
        icon="devices"
        [heading]="'devices.empty.heading' | transloco"
        [description]="'devices.empty.description' | transloco"
      />
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DevicesPage {}
