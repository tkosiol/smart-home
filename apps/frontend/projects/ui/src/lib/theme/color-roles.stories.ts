import type { Meta, StoryContext, StoryObj } from '@storybook/angular';
import { computeThemeVars, type ResolvedAppearance } from '@smart/theme';
import { expect } from 'storybook/test';
import { ColorRolesStoryComponent } from './color-roles.story-component';

const meta: Meta<ColorRolesStoryComponent> = {
  title: 'Grundlagen/Farbrollen',
  component: ColorRolesStoryComponent,
};
export default meta;

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
  await expect(canvas.getAllByRole('listitem')).toHaveLength(49 + 5);
};

export const Alle: StoryObj<ColorRolesStoryComponent> = {
  play: expectThemeApplied,
};

/** Non-default globals: the default theme CSS alone cannot satisfy this story's assertions. */
export const DunkelHoherKontrast: StoryObj<ColorRolesStoryComponent> = {
  globals: { seed: '#8a5a00', mode: 'dark', contrast: 'high' },
  play: expectThemeApplied,
};
