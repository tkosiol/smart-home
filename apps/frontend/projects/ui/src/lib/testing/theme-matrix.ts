import { DEFAULT_INSTANCE_APPEARANCE } from '@smart/contracts';
import { computeThemeVars, type ResolvedAppearance, type ResolvedMode } from '@smart/theme';
import { expect } from 'storybook/test';

export const MATRIX_MODES: readonly ResolvedMode[] = ['light', 'dark'];

/** One of the two theme combinations (light, dark; default seed and font) with its variables. */
export interface ThemeMatrixCell {
  readonly id: ResolvedMode;
  readonly mode: ResolvedMode;
  readonly title: string;
  readonly vars: Record<string, string>;
}

const MODE_TITLES: Record<ResolvedMode, string> = { light: 'hell', dark: 'dunkel' };

function resolve(mode: ResolvedMode): ResolvedAppearance {
  return {
    colors: { ...DEFAULT_INSTANCE_APPEARANCE.colors, coreOverrides: {} },
    shape: DEFAULT_INSTANCE_APPEARANCE.shape,
    font: DEFAULT_INSTANCE_APPEARANCE.font,
    mode,
    contrast: 'standard',
  };
}

/** Light and dark with the default seed, standard contrast and the default font. */
export function themeMatrixCells(): ThemeMatrixCell[] {
  return MATRIX_MODES.map((mode) => ({
    id: mode,
    mode,
    title: MODE_TITLES[mode],
    vars: { 'color-scheme': mode, ...computeThemeVars(resolve(mode)) },
  }));
}

/** '#rrggbb' as the browser reports computed colors. */
export const rgb = (hex: string): string =>
  `rgb(${[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;

/**
 * Checks that the matrix rendered light and dark and that each cell really carries its own theme:
 * the primary role of the cell and its surface background match the theme engine.
 */
export async function expectThemeMatrix(canvasElement: HTMLElement): Promise<void> {
  const cells = [...canvasElement.querySelectorAll<HTMLElement>('.cell')];
  await expect(cells).toHaveLength(MATRIX_MODES.length);
  for (const cell of cells) {
    const expected = computeThemeVars(resolve(cell.dataset['mode'] as ResolvedMode));
    const style = getComputedStyle(cell);
    await expect(style.getPropertyValue('--mat-sys-primary').trim()).toBe(
      expected['--mat-sys-primary'],
    );
    await expect(style.backgroundColor).toBe(rgb(expected['--mat-sys-surface']!));
    await expect(style.colorScheme).toBe(cell.dataset['mode']);
  }
}
