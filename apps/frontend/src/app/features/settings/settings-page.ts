import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiList, UiListItem, UiPage } from '@smart/ui';
import { RUNTIME_CONFIG } from '../../core/config';

/** Entry point of the settings: appearance for everyone, the installation only when enabled. */
@Component({
  selector: 'app-settings-page',
  imports: [TranslocoPipe, UiList, UiListItem, UiPage],
  template: `
    <ui-page [heading]="'settings.title' | transloco">
      <ui-list>
        <ui-list-item
          icon="palette"
          route="/mehr/einstellungen/darstellung"
          [headline]="'settings.list.appearance' | transloco"
          [supporting]="'settings.list.appearanceHint' | transloco"
        />
        @if (instanceEditor) {
          <ui-list-item
            icon="home"
            route="/mehr/einstellungen/installation"
            [headline]="'settings.list.installation' | transloco"
            [supporting]="'settings.list.installationHint' | transloco"
          />
        }
      </ui-list>
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsPage {
  protected readonly instanceEditor = inject(RUNTIME_CONFIG).features.instanceAppearanceEditor;
}
