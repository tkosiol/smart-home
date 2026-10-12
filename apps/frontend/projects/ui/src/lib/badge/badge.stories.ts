import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiIcon } from '../icon/icon';
import { UiBadge } from './badge';

const meta: Meta<UiBadge> = {
  title: 'Anzeige/Badge',
  component: UiBadge,
  decorators: [moduleMetadata({ imports: [UiIcon] })],
};
export default meta;

export const Zahlen: StoryObj<UiBadge> = {
  render: () => ({
    template: `
      <div style="display: flex; gap: 32px; padding: 16px">
        <ui-badge [count]="0"><ui-icon name="notifications" /></ui-badge>
        <ui-badge [count]="5"><ui-icon name="notifications" /></ui-badge>
        <ui-badge [count]="120"><ui-icon name="notifications" /></ui-badge>
      </div>`,
  }),
  play: async ({ canvasElement }) => {
    const counts = [...canvasElement.querySelectorAll('.count')].map((c) => c.textContent?.trim());
    await expect(counts).toEqual(['5', '99+']);
  },
};
