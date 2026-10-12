import type { Meta, StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { ICON_CODEPOINTS } from './icon-codepoints';
import { UiIcon } from './icon';

const names = Object.keys(ICON_CODEPOINTS);

const meta: Meta<UiIcon> = {
  title: 'Inhalt/Icon',
  component: UiIcon,
};
export default meta;

export const Alle: StoryObj<UiIcon> = {
  render: () => ({
    props: { names },
    template: `
      <ul style="display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: 12px; padding: 0; list-style: none">
        @for (name of names; track name) {
          <li style="display: flex; align-items: center; gap: 8px"><ui-icon [name]="name" />{{ name }}</li>
        }
      </ul>`,
  }),
  play: async ({ canvasElement }) => {
    await document.fonts.load('24px "Smart Symbols"');
    await expect(document.fonts.check('24px "Smart Symbols"')).toBe(true);
    await expect(canvasElement.querySelectorAll('ui-icon')).toHaveLength(names.length);
  },
};

export const GroessenUndGefuellt: StoryObj<UiIcon> = {
  render: () => ({
    template: `
      <div style="display: flex; align-items: center; gap: 16px">
        <ui-icon name="water_drop" size="sm" />
        <ui-icon name="water_drop" />
        <ui-icon name="water_drop" size="lg" />
        <ui-icon name="water_drop" size="lg" filled label="Feuchtigkeit" />
      </div>`,
  }),
  play: async ({ canvas }) => {
    const labelled = canvas.getByRole('img', { name: 'Feuchtigkeit' });
    await expect(getComputedStyle(labelled).fontVariationSettings).toContain('"FILL" 1');
    await expect(getComputedStyle(labelled).width).toBe('40px');
  },
};
