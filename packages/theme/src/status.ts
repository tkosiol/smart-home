import { Hct, TonalPalette, argbFromHex, hexFromArgb } from '@material/material-color-utilities';
import type { ResolvedContrast, ResolvedMode } from './scheme.js';

export const STATUS_NAMES = ['dry', 'ok', 'wet', 'warning', 'offline'] as const;
export type StatusName = (typeof STATUS_NAMES)[number];

/** Semantic hues (HCT): dry ~78 (amber), ok ~146, wet ~263. */
const STATUS_SOURCES: Record<Exclude<StatusName, 'offline' | 'warning'>, string> = {
  dry: '#c18500',
  ok: '#2e7d32',
  wet: '#1565c0',
};

/** The scheme's error roles; warnings use them (see `statusVars`). */
export interface ErrorRoles {
  color: string;
  onColor: string;
  container: string;
  onContainer: string;
}

/**
 * Material's harmonization rotates by up to 15 degrees, which can pull status hues towards their
 * neighbours. Capping it keeps them apart while still leaning towards the source.
 */
const MAX_HARMONIZE_DEGREES = 8;

/** Tones for [color, on-color, container, on-container]. */
const TONES: Record<ResolvedMode, Record<ResolvedContrast, [number, number, number, number]>> = {
  light: { standard: [40, 100, 90, 10], medium: [35, 100, 88, 5], high: [25, 100, 85, 0] },
  // Dark color tones stay at or below 85: lighter tones leave too little chroma to tell hues apart
  // (contrast against the dark surface is still above 10:1).
  dark: { standard: [80, 20, 30, 90], medium: [82, 10, 25, 95], high: [85, 0, 15, 100] },
};

/**
 * Warnings use the error roles: red, orange and amber collapse into similar dark browns at the tones
 * white text needs, so a separate orange cannot stay apart from both error and dry. Icon and label
 * tell a warning from an error.
 */
/**
 * In dark mode the error roles (used for warnings) get almost white at higher contrast; a fixed,
 * darker grey keeps offline apart from them (contrast to the dark surface stays above 7:1).
 */
const OFFLINE_DARK_TONE = 70;

export function statusVars(
  source: number,
  mode: ResolvedMode,
  contrast: ResolvedContrast,
  error: ErrorRoles,
): Record<string, string> {
  const [color, onColor, container, onContainer] = TONES[mode][contrast];
  const vars: Record<string, string> = {
    '--smart-status-warning': error.color,
    '--smart-status-on-warning': error.onColor,
    '--smart-status-warning-container': error.container,
    '--smart-status-on-warning-container': error.onContainer,
  };
  for (const name of STATUS_NAMES) {
    if (name === 'warning') continue;
    const palette = statusPalette(name, source);
    const colorTone = name === 'offline' && mode === 'dark' ? OFFLINE_DARK_TONE : color;
    vars[`--smart-status-${name}`] = hexFromArgb(palette.tone(colorTone));
    vars[`--smart-status-on-${name}`] = hexFromArgb(palette.tone(onColor));
    vars[`--smart-status-${name}-container`] = hexFromArgb(palette.tone(container));
    vars[`--smart-status-on-${name}-container`] = hexFromArgb(palette.tone(onContainer));
  }
  return vars;
}

function statusPalette(name: Exclude<StatusName, 'warning'>, source: number): TonalPalette {
  // Offline means "no state": a neutral grey, told apart from the others by its missing chroma.
  if (name === 'offline') return TonalPalette.fromHueAndChroma(0, 0);
  return TonalPalette.fromInt(harmonize(argbFromHex(STATUS_SOURCES[name]), source));
}

/** Like `Blend.harmonize`, but with a smaller maximum rotation. */
function harmonize(design: number, source: number): number {
  const from = Hct.fromInt(design);
  const to = Hct.fromInt(source);
  const increase = (((to.hue - from.hue) % 360) + 360) % 360;
  const difference = Math.min(increase, 360 - increase);
  const rotation = Math.min(difference / 2, MAX_HARMONIZE_DEGREES) * (increase <= 180 ? 1 : -1);
  return Hct.from((((from.hue + rotation) % 360) + 360) % 360, from.chroma, from.tone).toInt();
}
