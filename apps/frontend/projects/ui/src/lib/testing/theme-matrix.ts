import { DEFAULT_INSTANCE_APPEARANCE } from '@smart/contracts';
import {
  computeThemeVars,
  type ResolvedAppearance,
  type ResolvedContrast,
  type ResolvedMode,
} from '@smart/theme';
import { expect } from 'storybook/test';

/** A strong red (spec 2.7): with it, `error` and `primary` move close together. */
export const MATRIX_RED_SEED = '#d32f2f';

/** The two seeds every new building block is checked with: the default and the strong red. */
export const MATRIX_SEEDS: readonly string[] = [
  DEFAULT_INSTANCE_APPEARANCE.colors.seed,
  MATRIX_RED_SEED,
];

export const MATRIX_MODES: readonly ResolvedMode[] = ['light', 'dark'];
export const MATRIX_CONTRASTS: readonly ResolvedContrast[] = ['standard', 'medium', 'high'];

/** One of the twelve theme combinations with the variables that render it. */
export interface ThemeMatrixCell {
  readonly id: string;
  readonly seed: string;
  readonly mode: ResolvedMode;
  readonly contrast: ResolvedContrast;
  readonly title: string;
  readonly vars: Record<string, string>;
}

const MODE_TITLES: Record<ResolvedMode, string> = { light: 'hell', dark: 'dunkel' };
const CONTRAST_TITLES: Record<ResolvedContrast, string> = {
  standard: 'Standard',
  medium: 'Mittel',
  high: 'Hoch',
};

function resolve(seed: string, mode: ResolvedMode, contrast: ResolvedContrast): ResolvedAppearance {
  return {
    colors: { ...DEFAULT_INSTANCE_APPEARANCE.colors, seed, coreOverrides: {} },
    shape: DEFAULT_INSTANCE_APPEARANCE.shape,
    font: DEFAULT_INSTANCE_APPEARANCE.font,
    mode,
    contrast,
  };
}

/** Seeds × modes × contrasts, each with its theme variables and `color-scheme`. */
export function themeMatrixCells(seeds: readonly string[]): ThemeMatrixCell[] {
  return seeds.flatMap((seed) =>
    MATRIX_MODES.flatMap((mode) =>
      MATRIX_CONTRASTS.map((contrast) => ({
        id: `${seed}-${mode}-${contrast}`,
        seed,
        mode,
        contrast,
        title: `${seed} · ${MODE_TITLES[mode]} · ${CONTRAST_TITLES[contrast]}`,
        vars: { 'color-scheme': mode, ...computeThemeVars(resolve(seed, mode, contrast)) },
      })),
    ),
  );
}

/** '#rrggbb' as the browser reports computed colors. */
export const rgb = (hex: string): string =>
  `rgb(${[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;

/**
 * Checks that the matrix rendered all twelve combinations and that each cell really carries its
 * own theme: the primary role of the cell and its surface background match the theme engine.
 */
export async function expectThemeMatrix(canvasElement: HTMLElement): Promise<void> {
  const cells = [...canvasElement.querySelectorAll<HTMLElement>('.cell')];
  await expect(cells).toHaveLength(
    MATRIX_SEEDS.length * MATRIX_MODES.length * MATRIX_CONTRASTS.length,
  );
  for (const cell of cells) {
    const expected = computeThemeVars(
      resolve(
        cell.dataset['seed']!,
        cell.dataset['mode'] as ResolvedMode,
        cell.dataset['contrast'] as ResolvedContrast,
      ),
    );
    const style = getComputedStyle(cell);
    await expect(style.getPropertyValue('--mat-sys-primary').trim()).toBe(
      expected['--mat-sys-primary'],
    );
    await expect(style.backgroundColor).toBe(rgb(expected['--mat-sys-surface']!));
    await expect(style.colorScheme).toBe(cell.dataset['mode']);
  }
}
