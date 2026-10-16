import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Language } from '@smart/contracts';
import { ThemeService, UiCard, UiPage, UiStack, type UiOption } from '@smart/ui';
import { UiSegmentedButton, UiThemeEditor } from '@smart/ui/forms';
import { LanguageService } from '../../core/i18n';

/** Each language is named in itself, so it can be found whatever language is active. */
const LANGUAGE_OPTIONS: readonly UiOption<Language>[] = [
  { value: 'de', label: 'Deutsch' },
  { value: 'en', label: 'English' },
];

/** Personal appearance: language and theme; every change applies at once. */
@Component({
  selector: 'app-appearance-page',
  imports: [TranslocoPipe, UiCard, UiPage, UiSegmentedButton, UiStack, UiThemeEditor],
  template: `
    <ui-page [heading]="'settings.appearance.title' | transloco">
      <ui-stack gap="xl">
        <ui-card variant="low" [level]="2" [heading]="'settings.appearance.language' | transloco">
          <ui-segmented-button
            [label]="'settings.appearance.language' | transloco"
            [options]="languageOptions"
            [value]="language.language()"
            (valueChange)="chooseLanguage($event)"
          />
        </ui-card>
        <ui-theme-editor
          mode="personal"
          [instance]="theme.instance()"
          [personal]="theme.personal()"
          (personalChange)="theme.setPersonal($event)"
          (resetRequested)="theme.resetPersonal()"
        />
      </ui-stack>
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppearancePage {
  protected readonly language = inject(LanguageService);
  protected readonly theme = inject(ThemeService);
  protected readonly languageOptions = LANGUAGE_OPTIONS;

  protected chooseLanguage(language: Language | undefined): void {
    if (language) this.language.setLanguage(language);
  }
}
