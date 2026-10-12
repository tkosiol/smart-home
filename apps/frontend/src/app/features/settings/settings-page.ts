import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiPage } from '@smart/ui';

/** Placeholder until the page is built. */
@Component({
  selector: 'app-settings-page',
  imports: [TranslocoPipe, UiPage],
  template: `<ui-page [heading]="'settings.title' | transloco" />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage {}
