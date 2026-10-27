import { ChangeDetectionStrategy, Component, Directive, computed, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { UiIcon } from '../icon/icon';
import { mediaQuerySignal } from '../theme/media-queries';
import type { UiNavDestination, UiWindowClass } from './navigation';

export const MEDIUM = '(min-width: 600px)';
export const EXPANDED = '(min-width: 840px)';

/** Marks the element shown above the page, e.g. a `ui-top-app-bar`. */
@Directive({ selector: '[uiShellTopBar]' })
export class UiShellTopBar {}

/** Marks the element shown below the top bar, e.g. a `ui-banner`. */
@Directive({ selector: '[uiShellBanner]' })
export class UiShellBanner {}

/**
 * The app frame: navigation as a bottom bar (compact), a rail (medium) or a drawer (expanded),
 * with the main content beside or above it. The navigation is one `nav` landmark in every form.
 */
@Component({
  selector: 'ui-adaptive-shell',
  imports: [RouterLink, RouterLinkActive, UiIcon],
  templateUrl: './adaptive-shell.html',
  styleUrl: './adaptive-shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-window-class]': 'windowClass()' },
})
export class UiAdaptiveShell {
  readonly destinations = input.required<readonly UiNavDestination[]>();
  /** Accessible name of the navigation landmark. */
  readonly navigationLabel = input.required<string>();

  private readonly medium = mediaQuerySignal(MEDIUM);
  private readonly expanded = mediaQuerySignal(EXPANDED);

  readonly windowClass = computed<UiWindowClass>(() => {
    if (this.expanded()) return 'expanded';
    if (this.medium()) return 'medium';
    return 'compact';
  });
}
