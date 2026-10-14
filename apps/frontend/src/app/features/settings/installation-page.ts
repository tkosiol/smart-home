import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ThemeService, UiPage } from '@smart/ui';
import { UiThemeEditor } from '@smart/ui/forms';

/** Appearance of the whole installation (colors, shapes, font); reachable only for the platform admin. */
@Component({
  selector: 'app-installation-page',
  imports: [TranslocoPipe, UiPage, UiThemeEditor],
  template: `
    <ui-page [heading]="'settings.installation.title' | transloco">
      <ui-theme-editor
        mode="instance"
        [instance]="theme.instance()"
        (instanceChange)="theme.setInstance($event)"
        (resetRequested)="theme.resetInstance()"
      />
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstallationPage {
  protected readonly theme = inject(ThemeService);
}
