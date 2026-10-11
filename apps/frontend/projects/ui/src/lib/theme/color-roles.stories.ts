import type { Meta, StoryObj } from '@storybook/angular';
import { computeThemeVars, type ResolvedAppearance } from '@smart/theme';
import { expect } from 'storybook/test';
import { ColorRolesStoryComponent } from './color-roles.story-component';

const meta: Meta<ColorRolesStoryComponent> = {
  title: 'Grundlagen/Farbrollen',
  component: ColorRolesStoryComponent,
};
export default meta;

export const Alle: StoryObj<ColorRolesStoryComponent> = {
  play: async ({ globals, canvas }) => {
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
  },
};
