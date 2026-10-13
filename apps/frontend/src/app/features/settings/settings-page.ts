import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiList, UiListItem, UiPage } from '@smart/ui';
import { AuthService } from '../../core/auth';

/** Entry point of the settings: appearance for everyone, the installation only for the platform admin. */
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
        @if (isPlatformAdmin()) {
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
  private readonly auth = inject(AuthService);
  protected readonly isPlatformAdmin = computed(() => this.auth.me()?.isPlatformAdmin === true);
}
