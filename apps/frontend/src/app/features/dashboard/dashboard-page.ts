import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiPage } from '@smart/ui';

/** Placeholder until the page is built. */
@Component({
  selector: 'app-dashboard-page',
  imports: [TranslocoPipe, UiPage],
  template: `<ui-page [heading]="'dashboard.title' | transloco" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {}
