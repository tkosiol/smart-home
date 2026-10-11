import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiButton } from '../button/button';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../testing/story-helpers';
import { UiEmptyState, UiEmptyStateActions } from './empty-state';

const meta: Meta<UiEmptyState> = {
  title: 'Inhalt/Leer-Zustand',
  component: UiEmptyState,
  decorators: [moduleMetadata({ imports: [UiEmptyStateActions, UiButton] }), withNarrowFrame],
};
export default meta;

export const Raeume: StoryObj<UiEmptyState> = {
  render: () => ({
    template: `
      <ui-empty-state icon="meeting_room" heading="Noch keine Räume" text="Hier erscheinen deine Räume mit ihren Geräten, sobald du sie anlegst.">
        <div uiEmptyStateActions><ui-button icon="add">Raum anlegen</ui-button></div>
      </ui-empty-state>`,
  }),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Noch keine Räume' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Raum anlegen' })).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};
