import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiBadge } from '../badge/badge';
import { UiIconButton } from '../button/icon-button';
import { UiIcon } from '../icon/icon';
import { expectNoHorizontalOverflow, withPhoneFrame } from '../testing/story-helpers';
import { UiTopAppBar, UiTopAppBarActions } from './top-app-bar';

const meta: Meta<UiTopAppBar> = {
  title: 'Navigation/Top-App-Bar',
  component: UiTopAppBar,
  decorators: [moduleMetadata({ imports: [UiTopAppBarActions, UiIconButton, UiBadge, UiIcon] })],
};
export default meta;

export const Standard: StoryObj<UiTopAppBar> = {
  render: () => ({
    template: `
      <ui-top-app-bar heading="Haus Sonnenweg">
        <ui-icon-button uiTopAppBarActions icon="notifications" label="Benachrichtigungen" />
      </ui-top-app-bar>`,
  }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Haus Sonnenweg')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Benachrichtigungen' })).toBeVisible();
    await expect(canvas.queryByRole('heading')).toBeNull();
  },
};

export const Schmal: StoryObj<UiTopAppBar> = {
  decorators: [withPhoneFrame],
  render: () => ({
    template: `
      <ui-top-app-bar heading="Haushalt der Familie Müller-Lüdenscheidt-Schmidtbauer am Sonnenweg">
        <ui-icon-button uiTopAppBarActions icon="notifications" label="Benachrichtigungen" />
        <ui-icon-button uiTopAppBarActions icon="settings" label="Einstellungen" />
      </ui-top-app-bar>`,
  }),
  play: async ({ canvasElement, canvas }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
    const title = canvasElement.querySelector('.title')!;
    await expect(title.scrollHeight).toBeLessThanOrEqual(title.clientHeight);
    await expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
    for (const name of ['Benachrichtigungen', 'Einstellungen']) {
      // Material's icon button is 40 px; its touch target (a 48 px pseudo-box) is what a finger hits.
      const target = canvas
        .getByRole('button', { name })
        .querySelector('.mat-mdc-button-touch-target')!;
      const rect = target.getBoundingClientRect();
      await expect(rect.width).toBeGreaterThanOrEqual(48);
      await expect(rect.height).toBeGreaterThanOrEqual(48);
    }
  },
};
