import { Hct, argbFromHex } from '@material/material-color-utilities';
import { DEFAULT_INSTANCE_APPEARANCE, type ThemeColors } from '@smart/contracts';
import { describe, expect, it } from 'vitest';
import { computeThemeVars, contrastRatio } from './index.js';
import { buildScheme } from './scheme.js';

/**
 * Spike (design concept, section 6): can warnings get their own orange palette, apart from `error`
 * and `dry` in every mode/contrast combination and for red and yellow seeds?
 */

/** Candidate warning source at HCT hue 50 (orange), chroma ~59 at tone 50. */
const WARNING_SOURCE = '#bf5a00';
const DRY_SOURCE = '#c18500';
const MAX_HARMONIZE_DEGREES = 8;
/** Warning-only cap: with 8 degrees red and yellow seeds pull warning into error or dry. */
const WARNING_MAX_HARMONIZE_DEGREES = 4;
const MIN_HUE_DISTANCE = 18;
const MIN_CONTRAST = 4.5;

const circular = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

/** Mirror of `harmonize` in status.ts (hue only): rotation towards the source, capped at 8 degrees. */
function harmonizedHue(designHex: string, source: number, maxDegrees: number): number {
  const from = Hct.fromInt(argbFromHex(designHex)).hue;
  const to = Hct.fromInt(source).hue;
  const increase = (((to - from) % 360) + 360) % 360;
  const difference = Math.min(increase, 360 - increase);
  const rotation = Math.min(difference / 2, maxDegrees) * (increase <= 180 ? 1 : -1);
  return (((from + rotation) % 360) + 360) % 360;
}

const seeds = [
  { name: 'standard', seed: DEFAULT_INSTANCE_APPEARANCE.colors.seed },
  { name: 'red', seed: '#d32f2f' },
  { name: 'yellow', seed: '#f9a825' },
];
const cases = seeds.flatMap(({ name, seed }) =>
  (['light', 'dark'] as const).flatMap((mode) =>
    (['standard', 'medium', 'high'] as const).map((contrast) => ({ name, seed, mode, contrast })),
  ),
);

// Skipped. With source #bf5a00 (hue 50) and a harmonisation cap of 8 degrees the hue distance is 17.0
// degrees to `error` (red seed) and 17.3 degrees to `dry` (yellow seed); no source hue passes both.
// With a warning-only cap of 4 degrees (WARNING_MAX_HARMONIZE_DEGREES below) this test passes: at
// least 21.0 degrees to `error` and 21.4 degrees to `dry`, contrast at least 6.45:1. But a separate
// warning palette then fails the existing colour-distinctness tests in theme.spec.ts (CIE76):
// warning/dry reaches only 9.2 for the status colours (limit 20) and 7.5 for the containers
// (limit 12), at the tones white text needs, in 25 of 42 seed/mode/contrast cases; hues 47 to 53
// do not help (hue 47 gives 11.3 and 8.6). So warnings keep the error roles. To retry, give
// `warning` an entry in STATUS_SOURCES in status.ts (cap 4) and unskip.
describe.skip('a separate warning colour', () => {
  it.each(cases)('$name $mode $contrast', ({ seed, mode, contrast }) => {
    const colors: ThemeColors = {
      seed,
      variant: 'tonalSpot',
      colorMatch: false,
      coreOverrides: {},
    };
    const source = argbFromHex(seed);
    const warning = harmonizedHue(WARNING_SOURCE, source, WARNING_MAX_HARMONIZE_DEGREES);
    const dry = harmonizedHue(DRY_SOURCE, source, MAX_HARMONIZE_DEGREES);
    const error = buildScheme(colors, mode, contrast).errorPalette.hue;
    expect(circular(warning, error), 'warning/error hue').toBeGreaterThanOrEqual(MIN_HUE_DISTANCE);
    expect(circular(warning, dry), 'warning/dry hue').toBeGreaterThanOrEqual(MIN_HUE_DISTANCE);

    const vars = computeThemeVars({
      colors,
      shape: 'standard',
      font: 'roboto-flex',
      mode,
      contrast,
    });
    expect(
      contrastRatio(vars['--smart-status-on-warning']!, vars['--smart-status-warning']!),
      'on-warning',
    ).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(
      contrastRatio(
        vars['--smart-status-on-warning-container']!,
        vars['--smart-status-warning-container']!,
      ),
      'on-warning-container',
    ).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
});
