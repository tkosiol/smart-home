import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiButton } from '../button/button';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../testing/story-helpers';
import { UiBanner, UiBannerActions } from './banner';

const meta: Meta<UiBanner> = {
  title: 'Rückmeldung/Banner',
  component: UiBanner,
  decorators: [moduleMetadata({ imports: [UiBannerActions, UiButton] })],
};
export default meta;

export const Toene: StoryObj<UiBanner> = {
  render: () => ({
    template: `
      <div style="display: grid; gap: 16px; max-width: 560px">
        <ui-banner heading="Neu">Räume lassen sich jetzt sortieren.</ui-banner>
        <ui-banner tone="warning" heading="Batterie schwach">Der Sensor im Bad meldet 10 %.
          <div uiBannerActions><ui-button variant="text">Zum Gerät</ui-button></div>
        </ui-banner>
        <ui-banner tone="offline">Keine Verbindung. Änderungen werden gesendet, sobald du wieder online bist.</ui-banner>
      </div>`,
  }),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('status')).toHaveLength(3);
    await expect(canvas.getByRole('button', { name: 'Zum Gerät' })).toBeVisible();
  },
};

export const Schmal: StoryObj<UiBanner> = {
  decorators: [withNarrowFrame],
  render: () => ({
    template: `<ui-banner tone="warning" heading="Verbindungsunterbrechungsbenachrichtigung">Gatewaykommunikationsstörung</ui-banner>`,
  }),
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};
