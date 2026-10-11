import { componentWrapperDecorator } from '@storybook/angular';
import { expect } from 'storybook/test';

/** Renders the story inside a 320px wide frame – the narrowest phone the app supports. */
export const withNarrowFrame = componentWrapperDecorator(
  (story) => `<div class="story-narrow" style="width: 320px; max-width: 100%">${story}</div>`,
);

/** Fails when content is wider than its frame, i.e. the page would scroll sideways. */
export async function expectNoHorizontalOverflow(element: Element): Promise<void> {
  await expect(element.scrollWidth, 'content wider than its frame').toBeLessThanOrEqual(
    element.clientWidth,
  );
}
