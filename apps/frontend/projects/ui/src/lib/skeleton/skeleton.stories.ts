import type { Meta, StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiSkeleton } from './skeleton';

const meta: Meta<UiSkeleton> = { title: 'Inhalt/Skeleton', component: UiSkeleton };
export default meta;

export const Varianten: StoryObj<UiSkeleton> = {
  render: () => ({
    template: `
      <div role="status" aria-label="Lädt" aria-busy="true" style="display: grid; gap: 16px; max-width: 360px">
        <ui-skeleton variant="circle" />
        <ui-skeleton [lines]="3" />
        <ui-skeleton variant="block" />
      </div>`,
  }),
  play: async ({ canvasElement }) => {
    const skeletons = canvasElement.querySelectorAll('ui-skeleton');
    await expect(skeletons).toHaveLength(3);
    for (const skeleton of skeletons) await expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    await expect(skeletons[1]!.querySelectorAll('.line')).toHaveLength(3);
  },
};
