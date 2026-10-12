import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ThemeService } from '../theme/theme.service';
import { UiThemeEditor } from './theme-editor';

/** Storybook only: the personal editor wired to the ThemeService, as the settings page will be in 3d. */
@Component({
  selector: 'ui-theme-editor-live',
  imports: [UiThemeEditor],
  template: `<ui-theme-editor
    mode="personal"
    [instance]="theme.instance()"
    [personal]="theme.personal()"
    (personalChange)="theme.setPersonal($event)"
    (resetRequested)="theme.resetPersonal()"
  />`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeEditorLiveStoryComponent {
  protected readonly theme = inject(ThemeService);
}
