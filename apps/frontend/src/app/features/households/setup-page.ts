import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { displayNameSchema } from '@smart/contracts';
import { UiButton, UiPage, UiStack } from '@smart/ui';
import { UiSelect, UiTextField } from '@smart/ui/forms';
import { API_BASE, ApiClient, injectShowApiError } from '../../core/api';
import { AuthService } from '../../core/auth';
import { HouseholdContext } from '../../core/household';
import { browserTimeZone, timeZoneOptions } from './time-zones';

/**
 * Creates a household: the first one after sign-in, or another one from the switch page (then it
 * can be cancelled). The page stands outside the shell, so it brings its own `main` landmark.
 */
@Component({
  selector: 'app-setup-page',
  imports: [TranslocoPipe, UiButton, UiPage, UiSelect, UiStack, UiTextField],
  template: `
    <main>
      <ui-page
        [heading]="'households.setup.title' | transloco"
        [description]="'households.setup.description' | transloco"
      >
        <form (submit)="create($event)" novalidate>
          <ui-stack gap="lg">
            <ui-text-field
              name="name"
              autocomplete="off"
              required
              [label]="'households.form.name' | transloco"
              [hint]="'households.form.nameHint' | transloco"
              [error]="nameInvalid() ? ('households.form.nameError' | transloco) : null"
              [(value)]="name"
            />
            <ui-select
              [label]="'households.form.timezone' | transloco"
              [hint]="'households.form.timezoneHint' | transloco"
              [options]="zones"
              [value]="timezone()"
              (valueChange)="chooseZone($event)"
            />
            <ui-stack direction="row" gap="sm" wrap>
              <ui-button type="submit" [disabled]="busy()">{{
                'households.setup.submit' | transloco
              }}</ui-button>
              @if (canCancel()) {
                <ui-button variant="text" route="/haushalte">{{
                  'households.setup.cancel' | transloco
                }}</ui-button>
              }
            </ui-stack>
          </ui-stack>
        </form>
      </ui-page>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupPage {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly showError = injectShowApiError();
  private readonly household = inject(HouseholdContext);

  protected readonly name = signal('');
  protected readonly timezone = signal(browserTimeZone());
  protected readonly zones = timeZoneOptions(this.timezone());
  protected readonly nameInvalid = signal(false);
  protected readonly busy = signal(false);
  /** Whoever already has a household may go back; whoever has none must set one up. */
  protected readonly canCancel = computed(() => this.household.households().length > 0);

  protected chooseZone(zone: string | undefined): void {
    if (zone) this.timezone.set(zone);
  }

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    const name = displayNameSchema.safeParse(this.name());
    this.nameInvalid.set(!name.success);
    if (!name.success) return;
    this.busy.set(true);
    try {
      this.auth.updateMe(
        await this.api.post(`${API_BASE}/households`, {
          name: name.data,
          timezone: this.timezone(),
        }),
      );
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }
}
