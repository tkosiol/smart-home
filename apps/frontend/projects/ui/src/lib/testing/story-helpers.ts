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

/** 288 px: the content width of a 320 px phone after the page's side padding (2 × 16 px). */
export const withPhoneFrame = componentWrapperDecorator(
  (story) => `<div class="story-narrow" style="width: 288px; max-width: 100%">${story}</div>`,
);

/** Fails when a word is split across lines, i.e. a label broke mid-word instead of at a space. */
export async function expectNoBrokenWords(root: Element): Promise<void> {
  const broken: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const match of (node.textContent ?? '').matchAll(/\S+/g)) {
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      // A word on one line has boxes on one line; a word broken mid-word spans several.
      const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
      if (lines.size > 1) broken.push(match[0]);
    }
  }
  await expect(broken, 'words broken across lines').toEqual([]);
}

/**
 * Size of the touch target of a ui-button or ui-icon-button: the invisible `::after` box of the
 * native control, which may be larger than the visible button.
 */
export function touchTargetSize(control: Element): { width: number; height: number } {
  const box = getComputedStyle(control, '::after');
  return { width: parseFloat(box.width), height: parseFloat(box.height) };
}
