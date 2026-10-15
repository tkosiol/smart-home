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
const MIN_HUE_DISTANCE = 18;
const MIN_CONTRAST = 4.5;

const circular = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

/** Mirror of `harmonize` in status.ts (hue only): rotation towards the source, capped at 8 degrees. */
function harmonizedHue(designHex: string, source: number): number {
  const from = Hct.fromInt(argbFromHex(designHex)).hue;
  const to = Hct.fromInt(source).hue;
  const increase = (((to - from) % 360) + 360) % 360;
  const difference = Math.min(increase, 360 - increase);
  const rotation = Math.min(difference / 2, MAX_HARMONIZE_DEGREES) * (increase <= 180 ? 1 : -1);
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

// Skipped: measured with source #bf5a00 (hue 50) the hue distance is 17.0 degrees to `error` for
// the red seed and 17.3 degrees to `dry` for the yellow seed (limit 18); no source hue passes both
// (hue 52 gives 19.0/15.3, hue 48 gives 15.0/19.3), because harmonization pulls `warning`, `dry`
// and the red seed towards each other. Contrast passes (min 6.43:1). So warnings keep the error
// roles. To retry, give `warning` an entry in STATUS_SOURCES in status.ts and unskip.
describe.skip('a separate warning colour', () => {
  it.each(cases)('$name $mode $contrast', ({ seed, mode, contrast }) => {
    const colors: ThemeColors = {
      seed,
      variant: 'tonalSpot',
      colorMatch: false,
      coreOverrides: {},
    };
    const source = argbFromHex(seed);
    const warning = harmonizedHue(WARNING_SOURCE, source);
    const dry = harmonizedHue(DRY_SOURCE, source);
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
