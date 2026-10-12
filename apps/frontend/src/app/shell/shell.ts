import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslocoPipe, translateSignal } from '@jsverse/transloco';
import {
  UiAdaptiveShell,
  UiBadge,
  UiIcon,
  UiIconButton,
  UiShellTopBar,
  UiTopAppBar,
  UiTopAppBarActions,
  type UiNavDestination,
} from '@smart/ui';
import { MAIN_DESTINATIONS } from './navigation';

/** The frame around every page: navigation, top bar with household name and bell. */
@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    TranslocoPipe,
    UiAdaptiveShell,
    UiBadge,
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

  protected readonly destinations = computed<UiNavDestination[]>(() =>
    MAIN_DESTINATIONS.map(({ route, icon, exact }, index) => ({
      route,
      icon,
      exact,
      label: this.labels[index](),
    })),
  );
}
