import { STATUS_NAMES } from '@smart/theme';

/** A color tile: the fill role, optionally with the role meant for text on it. */
export interface ColorSwatch {
  readonly name: string;
  readonly fill: string;
  readonly on?: { readonly name: string; readonly color: string };
}

export interface ColorGroup {
  readonly title: string;
  readonly swatches: readonly ColorSwatch[];
}

const mat = (name: string, onName?: string): ColorSwatch => ({
  name,
  fill: `var(--mat-sys-${name})`,
  ...(onName ? { on: { name: onName, color: `var(--mat-sys-${onName})` } } : {}),
});

const accent = (role: 'primary' | 'secondary' | 'tertiary'): ColorGroup['swatches'] => [
  mat(role, `on-${role}`),
  mat(`${role}-container`, `on-${role}-container`),
  mat(`${role}-fixed`, `on-${role}-fixed`),
  mat(`${role}-fixed-dim`, `on-${role}-fixed-variant`),
];

const status = (name: string): ColorGroup['swatches'] => [
  {
    name,
    fill: `var(--smart-status-${name})`,
    on: { name: `on-${name}`, color: `var(--smart-status-on-${name})` },
  },
  {
    name: `${name}-container`,
    fill: `var(--smart-status-${name}-container)`,
    on: { name: `on-${name}-container`, color: `var(--smart-status-on-${name}-container)` },
  },
];

/** Storybook overview: every fill shows the role meant for text on it, written in that role. */
export const COLOR_GROUPS: readonly ColorGroup[] = [
  { title: 'Primär', swatches: accent('primary') },
  { title: 'Sekundär', swatches: accent('secondary') },
  { title: 'Tertiär', swatches: accent('tertiary') },
  {
    title: 'Fehler',
    swatches: [mat('error', 'on-error'), mat('error-container', 'on-error-container')],
  },
  {
    title: 'Flächen',
    swatches: [
      mat('background', 'on-background'),
      mat('surface', 'on-surface'),
      mat('surface-variant', 'on-surface-variant'),
      mat('surface-dim', 'on-surface'),
      mat('surface-bright', 'on-surface'),
      mat('surface-container-lowest', 'on-surface'),
      mat('surface-container-low', 'on-surface'),
      mat('surface-container', 'on-surface'),
      mat('surface-container-high', 'on-surface'),
      mat('surface-container-highest', 'on-surface'),
    ],
  },
  {
    title: 'Invers',
    swatches: [
      mat('inverse-surface', 'inverse-on-surface'),
      mat('inverse-surface', 'inverse-primary'),
    ],
  },
  {
    title: 'Kontur und Sonstiges',
    swatches: [
      mat('outline'),
      mat('outline-variant'),
      mat('surface-tint'),
      mat('shadow'),
      mat('scrim'),
    ],
  },
  { title: 'Status', swatches: STATUS_NAMES.flatMap(status) },
];
