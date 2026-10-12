import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiButton } from '../button/button';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../testing/story-helpers';
import { UiCard, UiCardActions } from './card';

const meta: Meta<UiCard> = {
  title: 'Inhalt/Card',
  component: UiCard,
  decorators: [moduleMetadata({ imports: [UiCardActions, UiButton] })],
};
export default meta;

export const Varianten: StoryObj<UiCard> = {
  render: () => ({
    template: `
      <div style="display: grid; gap: 16px; max-width: 480px">
        <ui-card heading="Umrandet" description="Standard"><p>Inhalt</p></ui-card>
        <ui-card variant="filled" heading="Gefüllt"><p>Inhalt</p></ui-card>
        <ui-card variant="elevated" heading="Erhöht">
          <p>Inhalt</p>
          <div uiCardActions><ui-button variant="text">Details</ui-button></div>
        </ui-card>
      </div>`,
  }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 3, name: 'Umrandet' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Details' })).toBeVisible();
    await expect(canvas.getAllByRole('heading', { level: 3 })).toHaveLength(3);
  },
};

export const Schmal: StoryObj<UiCard> = {
  decorators: [withNarrowFrame],
  render: () => ({
    template: `<ui-card heading="Bodenfeuchtigkeitssensorkalibrierungsergebnis"><p>Donaudampfschifffahrtsgesellschaft</p></ui-card>`,
  }),
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};
