import type { IconName } from './icon/icon-codepoints';

/** One choice of a selection component (segmented button, chips, select). */
export interface UiOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: IconName;
}
