import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import { UiButton, UiCard, UiList, UiListItem, UiPage, UiStack } from '@smart/ui';
import { injectShowApiError } from '../../core/api';
import { AuthService } from '../../core/auth';
import {
  injectMoreEntries,
  visibleMoreEntries,
  type MoreEntry,
  type MoreEntryGroup,
} from '../../core/features';
import { HouseholdContext } from '../../core/household';
import { COMING_SOON_ENTRIES } from './coming-soon-entries';

/** The cards of the page in their order, each with its heading key (root translation). */
const GROUPS: readonly { readonly id: MoreEntryGroup; readonly headingKey: string }[] = [
  { id: 'household', headingKey: marker('app.more.groups.household') },
  { id: 'app', headingKey: marker('app.more.groups.app') },
];

/**
 * Everything beyond the four main destinations: registered entries plus what is still to come,
 * grouped into cards (spec 3.6) with a tonal icon container per entry.
 */
@Component({
  selector: 'app-more-page',
  imports: [TranslocoPipe, UiButton, UiCard, UiList, UiListItem, UiPage, UiStack],
  template: `
    <ui-page [heading]="'more.title' | transloco">
      <ui-stack gap="xl">
        <ui-stack gap="lg">
          @for (group of groups(); track group.id) {
            <ui-card variant="low" [level]="2" [heading]="group.headingKey | transloco">
              <ui-list>
                @for (entry of group.entries; track entry.id) {
                  <ui-list-item
                    leadingTone="surface"
                    [headline]="entry.labelKey | transloco"
                    [icon]="entry.icon"
                    [route]="entry.route"
                    [supporting]="entry.route ? undefined : ('more.comingSoon' | transloco)"
                  />
                }
              </ui-list>
            </ui-card>
          }
        </ui-stack>
        <ui-stack align="start">
          <ui-button variant="outlined" [disabled]="signingOut()" (pressed)="signOut()">{{
            'more.signOut' | transloco
          }}</ui-button>
        </ui-stack>
      </ui-stack>
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MorePage {
  private readonly auth = inject(AuthService);
  private readonly household = inject(HouseholdContext);
  private readonly allEntries = [...COMING_SOON_ENTRIES, ...injectMoreEntries()].sort(
    (a, b) => a.order - b.order,
  );
  /** Only what the user may use; the role comes from `me`, so this holds offline too. */
  protected readonly entries = computed(() =>
    visibleMoreEntries(this.allEntries, {
      role: this.household.current()?.role ?? null,
      platformAdmin: this.auth.me()?.isPlatformAdmin === true,
    }),
  );
  /** The cards that have entries, in the order of `GROUPS`; entries without a group are `app`. */
  protected readonly groups = computed(() =>
    GROUPS.map((group) => ({
      ...group,
      entries: this.entries().filter((entry: MoreEntry) => (entry.group ?? 'app') === group.id),
    })).filter((group) => group.entries.length > 0),
  );
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
