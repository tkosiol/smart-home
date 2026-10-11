import { Hct, TonalPalette, argbFromHex, hexFromArgb } from '@material/material-color-utilities';
import type { ResolvedContrast, ResolvedMode } from './scheme.js';

export const STATUS_NAMES = ['dry', 'ok', 'wet', 'warning', 'offline'] as const;
export type StatusName = (typeof STATUS_NAMES)[number];

/** Semantic hues (HCT): dry ~88 (amber-yellow), ok ~146, wet ~263, warning ~34. */
const STATUS_SOURCES: Record<Exclude<StatusName, 'offline'>, string> = {
  dry: '#c99a00',
  ok: '#2e7d32',
  wet: '#1565c0',
  warning: '#d84315',
};

/**
 * Material's harmonization rotates by up to 15 degrees, which can pull neighbouring status hues
 * (amber and orange) onto each other. Capping it keeps them apart while still leaning towards the source.
 */
const MAX_HARMONIZE_DEGREES = 8;

/** Tones for [color, on-color, container, on-container]. */
const TONES: Record<ResolvedMode, Record<ResolvedContrast, [number, number, number, number]>> = {
  light: { standard: [40, 100, 90, 10], medium: [35, 100, 88, 5], high: [25, 100, 85, 0] },
  // Dark color tones stay at or below 85: lighter tones leave too little chroma to tell hues apart
  // (contrast against the dark surface is still above 10:1).
  dark: { standard: [80, 20, 30, 90], medium: [82, 10, 25, 95], high: [85, 0, 15, 100] },
};

export function statusVars(
  source: number,
  mode: ResolvedMode,
  contrast: ResolvedContrast,
): Record<string, string> {
  const [color, onColor, container, onContainer] = TONES[mode][contrast];
  const vars: Record<string, string> = {};
  for (const name of STATUS_NAMES) {
    const palette = statusPalette(name, source);
    vars[`--smart-status-${name}`] = hexFromArgb(palette.tone(color));
    vars[`--smart-status-on-${name}`] = hexFromArgb(palette.tone(onColor));
    vars[`--smart-status-${name}-container`] = hexFromArgb(palette.tone(container));
    vars[`--smart-status-on-${name}-container`] = hexFromArgb(palette.tone(onContainer));
  }
  return vars;
}

function statusPalette(name: StatusName, source: number): TonalPalette {
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
