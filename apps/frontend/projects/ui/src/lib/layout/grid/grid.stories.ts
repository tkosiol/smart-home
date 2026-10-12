import { type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../../testing/story-helpers';
import { UiGrid } from './grid';

const meta: Meta<UiGrid> = { title: 'Layout/Grid', component: UiGrid };
export default meta;

const cells = Array.from(
  { length: 6 },
  (_, i) => `<div style="padding: 16px; outline: 1px dashed">Kachel ${i + 1}</div>`,
).join('');

export const Breit: StoryObj<UiGrid> = {
  render: () => ({
    template: `<div style="width: 1000px"><ui-grid data-testid="grid">${cells}</ui-grid></div>`,
  }),
  play: async ({ canvas }) => {
    const columns = getComputedStyle(canvas.getByTestId('grid')).gridTemplateColumns.split(' ');
    await expect(columns.length).toBe(4);
  },
};

export const Schmal: StoryObj<UiGrid> = {
  decorators: [withNarrowFrame],
  render: () => ({ template: `<ui-grid data-testid="grid" min="lg">${cells}</ui-grid>` }),
  play: async ({ canvas, canvasElement }) => {
    const columns = getComputedStyle(canvas.getByTestId('grid')).gridTemplateColumns.split(' ');
    await expect(columns.length).toBe(1);
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};
