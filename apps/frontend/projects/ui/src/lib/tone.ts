import type { StatusName } from '@smart/theme';

/** Material roles that come as a strong fill with an on-colour and as a container pair. */
export type UiRoleTone = 'primary' | 'secondary' | 'tertiary' | 'error';

/** A colour family: a Material role (`--mat-sys-*`) or a status colour (`--smart-status-*`). */
export type UiToneName = UiRoleTone | StatusName;

/**
 * A fill of one family: its strong colour (`error` → error / on-error), its container
 * (`error-container` → error-container / on-error-container) or the neutral `surface`
 * (surface-container-high / on-surface, used for tonal controls and devices of kind `other`).
 * Components render it as `data-tone`; `_tone.scss` holds the matching rules.
 */
export type UiTone = UiToneName | `${UiToneName}-container` | 'surface';
