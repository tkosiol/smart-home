import type { Meta, StoryContext, StoryObj } from '@storybook/angular';
import { computeThemeVars, type ResolvedAppearance } from '@smart/theme';
import { expect } from 'storybook/test';
import { COLOR_GROUPS } from './color-roles.groups';
import { ColorRolesStoryComponent } from './color-roles.story-component';

const meta: Meta<ColorRolesStoryComponent> = {
  title: 'Grundlagen/Farbrollen',
  component: ColorRolesStoryComponent,
};
export default meta;

/** '#rrggbb' as the browser reports computed colors. */
const rgb = (hex: string): string =>
  `rgb(${[1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;

/** Resolves the toolbar globals of the running story and checks that the theme was really applied. */
const expectThemeApplied = async ({ globals, canvas }: StoryContext): Promise<void> => {
  const resolved = {
    colors: {
      seed: globals['seed'],
      variant: globals['variant'],
      colorMatch: false,
      coreOverrides: {},
    },
    shape: globals['shape'],
    font: globals['font'],
    mode: globals['mode'],
    contrast: globals['contrast'],
  } as ResolvedAppearance;
  const expected = computeThemeVars(resolved);
  const actual = getComputedStyle(document.documentElement)
    .getPropertyValue('--mat-sys-primary')
    .trim();
  await expect(actual).toBe(expected['--mat-sys-primary']);
  const swatchCount = COLOR_GROUPS.reduce((count, group) => count + group.swatches.length, 0);
  await expect(canvas.getAllByRole('listitem')).toHaveLength(swatchCount);
  // Text on a fill is written in its on-role, so the tile itself shows whether the pair reads well.
  const onPrimary = canvas.getByText('on-primary', { selector: '.on' });
  await expect(getComputedStyle(onPrimary).color).toBe(rgb(expected['--mat-sys-on-primary']!));
  await expect(getComputedStyle(onPrimary.parentElement!).backgroundColor).toBe(
    rgb(expected['--mat-sys-primary']!),
  );
};

export const Alle: StoryObj<ColorRolesStoryComponent> = {
  play: expectThemeApplied,
};

/** Non-default globals: the default theme CSS alone cannot satisfy this story's assertions. */
export const DunkelHoherKontrast: StoryObj<ColorRolesStoryComponent> = {
  globals: { seed: '#8a5a00', mode: 'dark', contrast: 'high' },
  play: expectThemeApplied,
};
