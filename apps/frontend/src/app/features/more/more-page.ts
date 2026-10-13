import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiButton, UiList, UiListItem, UiPage, UiStack } from '@smart/ui';
import { injectShowApiError } from '../../core/api';
import { AuthService } from '../../core/auth';
import { injectMoreEntries } from '../../core/features';
import { COMING_SOON_ENTRIES } from './coming-soon-entries';

/** Everything beyond the four main destinations: registered entries plus what is still to come. */
@Component({
  selector: 'app-more-page',
  imports: [TranslocoPipe, UiButton, UiList, UiListItem, UiPage, UiStack],
  template: `
    <ui-page [heading]="'more.title' | transloco">
      <ui-stack gap="xl" align="start">
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
        <ui-button variant="outlined" [disabled]="signingOut()" (pressed)="signOut()">{{
          'more.signOut' | transloco
        }}</ui-button>
      </ui-stack>
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MorePage {
  protected readonly entries = [...COMING_SOON_ENTRIES, ...injectMoreEntries()].sort(
    (a, b) => a.order - b.order,
  );

  private readonly auth = inject(AuthService);
  private readonly showError = injectShowApiError();
  protected readonly signingOut = signal(false);

  /** Ends the session; the AuthService leads on to the sign-in page. A failing server is reported. */
  protected async signOut(): Promise<void> {
    this.signingOut.set(true);
    try {
      await this.auth.logout();
    } catch (error) {
      this.showError(error);
    } finally {
      this.signingOut.set(false);
    }
  }
}
