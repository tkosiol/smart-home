import { Blend, TonalPalette, argbFromHex, hexFromArgb } from '@material/material-color-utilities';
import type { ResolvedContrast, ResolvedMode } from './scheme.js';

export const STATUS_NAMES = ['dry', 'ok', 'wet', 'warning', 'offline'] as const;
export type StatusName = (typeof STATUS_NAMES)[number];

const STATUS_SOURCES: Record<StatusName, string> = {
  dry: '#c77800',
  ok: '#2e7d32',
  wet: '#1565c0',
  warning: '#d84315',
  offline: '#6f7378',
};

/** Tones for [color, on-color, container, on-container]. */
const TONES: Record<ResolvedMode, Record<ResolvedContrast, [number, number, number, number]>> = {
  light: { standard: [40, 100, 90, 10], medium: [35, 100, 88, 5], high: [25, 100, 85, 0] },
  dark: { standard: [80, 20, 30, 90], medium: [85, 10, 25, 95], high: [90, 0, 15, 100] },
};

export function statusVars(
  source: number,
  mode: ResolvedMode,
  contrast: ResolvedContrast,
): Record<string, string> {
  const [color, onColor, container, onContainer] = TONES[mode][contrast];
  const vars: Record<string, string> = {};
  for (const name of STATUS_NAMES) {
    const palette = TonalPalette.fromInt(
      Blend.harmonize(argbFromHex(STATUS_SOURCES[name]), source),
    );
    vars[`--smart-status-${name}`] = hexFromArgb(palette.tone(color));
    vars[`--smart-status-on-${name}`] = hexFromArgb(palette.tone(onColor));
    vars[`--smart-status-${name}-container`] = hexFromArgb(palette.tone(container));
    vars[`--smart-status-on-${name}-container`] = hexFromArgb(palette.tone(onContainer));
  }
  return vars;
}
