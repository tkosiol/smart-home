import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslocoPipe, translateSignal } from '@jsverse/transloco';
import {
  UiAdaptiveShell,
  UiAnnouncer,
  UiBadge,
  UiBanner,
  UiBannerActions,
  UiButton,
  UiIcon,
  UiIconButton,
  UiShellTopBar,
  UiTopAppBar,
  UiTopAppBarActions,
  type UiNavDestination,
} from '@smart/ui/shell';
import { AuthService } from '../core/auth';
import { HouseholdContext } from '../core/household';
import { AppUpdates, OnlineStatus } from '../core/pwa';
import { MAIN_DESTINATIONS } from './navigation';

/** The frame around every page: navigation, top bar with household name and bell. */
@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    TranslocoPipe,
    UiAdaptiveShell,
    UiBadge,
    UiBanner,
    UiBannerActions,
    UiButton,
    UiIcon,
    UiIconButton,
    UiShellTopBar,
    UiTopAppBar,
    UiTopAppBarActions,
  ],
  templateUrl: './shell.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell {
  private readonly labels = MAIN_DESTINATIONS.map(({ labelKey }) => translateSignal(labelKey));

  private readonly announcer = inject(UiAnnouncer);
  private readonly online = inject(OnlineStatus).online;
  private readonly auth = inject(AuthService);
  private readonly updates = inject(AppUpdates);
  private readonly household = inject(HouseholdContext);

  protected readonly householdName = computed(() => this.household.current()?.name ?? '');
  protected readonly canSwitchHousehold = computed(() => this.household.households().length > 1);

  /** Also when the browser says online but the server could not be asked (started from the device's copy). */
  protected readonly offline = computed(() => !this.online() || this.auth.status() === 'offline');
  protected readonly updateReady = this.updates.updateReady;
  private readonly offlineText = translateSignal('app.offline');
  private readonly updateText = translateSignal('app.update.text');

  protected readonly destinations = computed<UiNavDestination[]>(() =>
    MAIN_DESTINATIONS.map(({ route, icon, exact }, index) => ({
      route,
      icon,
      exact,
      label: this.labels[index](),
    })),
  );

  constructor() {
    // role="status" on insertion is not reliably announced, so say it explicitly.
    effect(() => {
      if (this.offline())
        untracked(() => void this.announcer.announce(this.offlineText(), 'polite'));
    });
    effect(() => {
      if (this.updateReady())
        untracked(() => void this.announcer.announce(this.updateText(), 'polite'));
    });
  }

  protected reload(): void {
    this.updates.reload();
  }
}
