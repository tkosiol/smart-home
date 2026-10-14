import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { marker } from '@jsverse/transloco-keys-manager/marker';
import { displayNameSchema } from '@smart/contracts';
import { UiBanner, UiButton, UiPage, UiSection, UiSnackbar, UiStack } from '@smart/ui';
import { UiSelect, UiTextField } from '@smart/ui/forms';
import { API_BASE, ApiClient, ApiError } from '../../core/api';
import { AuthService } from '../../core/auth';
import { HouseholdContext, injectHouseholdErrorHandler } from '../../core/household';
import { timeZoneOptions } from './time-zones';

/** In the root translation: the key is looked up in code, where the scope's keys are not found. */
const SAVED_KEY = marker('app.household.saved');

/** How long the "really leave?" question stays open. */
const CONFIRM_LEAVE_MS = 5000;

/**
 * Name and time zone of the current household, and leaving it. The page follows the current
 * household: when the user switches while it is open, it shows (and saves) the other one.
 */
@Component({
  selector: 'app-household-page',
  imports: [TranslocoPipe, UiBanner, UiButton, UiPage, UiSection, UiSelect, UiStack, UiTextField],
  template: `
    <ui-page [heading]="'households.household.title' | transloco">
      <ui-stack gap="xl">
        <form (submit)="save($event)" novalidate>
          <ui-stack gap="lg">
            <ui-text-field
              name="name"
              autocomplete="off"
              required
              [label]="'households.form.name' | transloco"
              [error]="nameInvalid() ? ('households.form.nameError' | transloco) : null"
              [(value)]="name"
            />
            <ui-select
              [label]="'households.form.timezone' | transloco"
              [hint]="'households.form.timezoneHint' | transloco"
              [options]="zones()"
              [value]="timezone()"
              (valueChange)="chooseZone($event)"
            />
            <ui-stack direction="row" gap="sm">
              <ui-button type="submit" [disabled]="busy()">{{
                'households.household.save' | transloco
              }}</ui-button>
            </ui-stack>
          </ui-stack>
        </form>
        <ui-section
          [heading]="'households.household.leave.title' | transloco"
          [description]="'households.household.leave.description' | transloco"
        >
          <ui-stack gap="md" align="start">
            @if (lastOwner()) {
              <ui-banner tone="warning">{{
                'households.household.leave.lastOwner' | transloco
              }}</ui-banner>
            }
            <ui-button variant="outlined" [disabled]="busy()" (pressed)="leave()">{{
              (confirming()
                ? 'households.household.leave.confirm'
                : 'households.household.leave.button'
              ) | transloco
            }}</ui-button>
          </ui-stack>
        </ui-section>
      </ui-stack>
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HouseholdPage {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly household = inject(HouseholdContext);
  private readonly router = inject(Router);
  private readonly snackbar = inject(UiSnackbar);
  private readonly transloco = inject(TranslocoService);
  private readonly handleError = injectHouseholdErrorHandler();
  private confirmTimer?: ReturnType<typeof setTimeout>;

  private readonly current = this.household.current;
  // Reset whenever the current household (or its saved values) changes, so the form never shows
  // another household's values while saving into this one.
  protected readonly name = linkedSignal(() => this.current()?.name ?? '');
  protected readonly timezone = linkedSignal(() => this.current()?.timezone ?? 'UTC');
  protected readonly zones = computed(() => timeZoneOptions(this.current()?.timezone ?? 'UTC'));
  protected readonly nameInvalid = signal(false);
  protected readonly busy = signal(false);
  private readonly currentId = computed(() => this.current()?.id);
  // After a switch the page shows another household: the question was about the one before.
  protected readonly confirming = linkedSignal<string | undefined, boolean>({
    source: this.currentId,
    computation: () => false,
  });
  protected readonly lastOwner = linkedSignal<string | undefined, boolean>({
    source: this.currentId,
    computation: () => false,
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.confirmTimer));
  }

  protected chooseZone(zone: string | undefined): void {
    if (zone) this.timezone.set(zone);
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const household = this.current();
    if (!household || this.busy()) return;
    const name = displayNameSchema.safeParse(this.name());
    this.nameInvalid.set(!name.success);
    if (!name.success) return;
    this.busy.set(true);
    try {
      await this.api.patch(`${API_BASE}/households/${household.id}`, {
        name: name.data,
        timezone: this.timezone(),
      });
      await this.auth.load();
      void this.snackbar.show(this.transloco.translate(SAVED_KEY));
    } catch (error) {
      this.handleError(error);
    } finally {
      this.busy.set(false);
    }
  }

  /** The first press asks again, the second leaves; the question closes by itself after 5 s. */
  protected async leave(): Promise<void> {
    if (!this.confirming()) {
      this.lastOwner.set(false);
      this.confirming.set(true);
      clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => this.confirming.set(false), CONFIRM_LEAVE_MS);
      return;
    }
    const household = this.current();
    const userId = this.auth.me()?.id;
    if (!household || !userId) return;
    clearTimeout(this.confirmTimer);
    this.confirming.set(false);
    this.busy.set(true);
    try {
      await this.api.delete(`${API_BASE}/households/${household.id}/members/${userId}`);
      await this.auth.load();
      // Whatever household is left is current now; without one the guard leads to the set-up.
      await this.router.navigateByUrl('/');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'household.lastOwner') {
        this.lastOwner.set(true);
      } else {
        this.handleError(error);
      }
    } finally {
      this.busy.set(false);
    }
  }
}
