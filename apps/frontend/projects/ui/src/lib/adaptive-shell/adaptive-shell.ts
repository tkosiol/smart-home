import { BreakpointObserver } from '@angular/cdk/layout';
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  computed,
  inject,
  input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { UiIcon } from '../icon/icon';
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

  private readonly breakpoints = toSignal(inject(BreakpointObserver).observe([MEDIUM, EXPANDED]));

  readonly windowClass = computed<UiWindowClass>(() => {
    const state = this.breakpoints();
    if (state?.breakpoints[EXPANDED]) return 'expanded';
    if (state?.breakpoints[MEDIUM]) return 'medium';
    return 'compact';
  });
}
