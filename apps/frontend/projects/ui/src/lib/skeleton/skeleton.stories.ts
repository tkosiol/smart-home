import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { EXPANDED } from '../adaptive-shell/adaptive-shell';
import { MEDIA_QUERIES } from '../theme/media-queries';
import { forcedMediaQueries } from '../theme/testing/fake-media-queries';
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
        <ui-skeleton variant="chart" />
      </div>`,
  }),
  play: async ({ canvasElement }) => {
    const skeletons = canvasElement.querySelectorAll('ui-skeleton');
    await expect(skeletons).toHaveLength(4);
    for (const skeleton of skeletons) await expect(skeleton).toHaveAttribute('aria-hidden', 'true');
    await expect(skeletons[1]!.querySelectorAll('.line')).toHaveLength(3);
    // The chart variant is as tall as a ui-chart (the large one from the Expanded window class),
    // so a card keeps its size while loading.
    const root = getComputedStyle(document.documentElement);
    const chart = skeletons[3]!;
    await expect(getComputedStyle(chart.querySelector('.shape')!).height).toBe(
      root
        .getPropertyValue(
          chart.hasAttribute('data-large') ? '--smart-size-chart-large' : '--smart-size-chart',
        )
        .trim(),
    );
  },
};

/** From the Expanded window class the chart, and so its skeleton, is taller. */
export const DiagrammBreit: StoryObj<UiSkeleton> = {
  decorators: [
    applicationConfig({
      providers: [{ provide: MEDIA_QUERIES, useValue: forcedMediaQueries({ [EXPANDED]: true }) }],
    }),
  ],
  render: () => ({
    template: `<div role="status" aria-label="Lädt" aria-busy="true"><ui-skeleton variant="chart" /></div>`,
  }),
  play: async ({ canvasElement }) => {
    const root = getComputedStyle(document.documentElement);
    await expect(getComputedStyle(canvasElement.querySelector('.shape')!).height).toBe(
      root.getPropertyValue('--smart-size-chart-large').trim(),
    );
  },
};
