import type { IconName } from '../icon/icon-codepoints';

/** One destination of the main navigation. */
export interface UiNavDestination {
  /** Router path, e.g. '/raeume'. */
  readonly route: string;
  /** Visible label, translated by the caller. */
  readonly label: string;
  readonly icon: IconName;
  /** Match the route exactly when active (true for '/'). */
  readonly exact?: boolean;
}

/** Material 3 window size classes the shell adapts to. */
export type UiWindowClass = 'compact' | 'medium' | 'expanded';
