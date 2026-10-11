import { type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiStack } from './stack';

const meta: Meta<UiStack> = { title: 'Layout/Stack', component: UiStack };
export default meta;

const items = `<span>Eins</span><span>Zwei</span><span>Drei</span>`;

export const Spalte: StoryObj<UiStack> = {
  render: () => ({ template: `<ui-stack data-testid="stack">${items}</ui-stack>` }),
  play: async ({ canvas }) => {
    const style = getComputedStyle(canvas.getByTestId('stack'));
    await expect(style.flexDirection).toBe('column');
    await expect(style.rowGap).toBe('12px');
  },
};

export const ZeileMitUmbruch: StoryObj<UiStack> = {
  render: () => ({
    template: `<ui-stack data-testid="stack" direction="row" gap="lg" align="center" justify="space-between" wrap>${items}</ui-stack>`,
  }),
  play: async ({ canvas }) => {
    const style = getComputedStyle(canvas.getByTestId('stack'));
    await expect(style.flexDirection).toBe('row');
    await expect(style.columnGap).toBe('16px');
    await expect(style.flexWrap).toBe('wrap');
    await expect(style.alignItems).toBe('center');
    await expect(style.justifyContent).toBe('space-between');
  },
};
