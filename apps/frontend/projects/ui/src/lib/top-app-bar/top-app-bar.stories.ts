import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiBadge } from '../badge/badge';
import { UiIconButton } from '../button/icon-button';
import { UiIcon } from '../icon/icon';
import {
  expectNoHorizontalOverflow,
  touchTargetSize,
  withNarrowFrame,
  withPhoneFrame,
} from '../testing/story-helpers';
import { expectThemeMatrix } from '../testing/theme-matrix';
import { ThemeMatrixStoryComponent, UiMatrixCell } from '../testing/theme-matrix.story-component';
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
      // The icon button is 40 px; its touch target (a 48 px pseudo-box) is what a finger hits.
      const target = touchTargetSize(canvas.getByRole('button', { name }));
      await expect(target.width).toBeGreaterThanOrEqual(48);
      await expect(target.height).toBeGreaterThanOrEqual(48);
    }
  },
};

/** The overview's bar on a phone: large household name, tonal actions (spec 3.1). */
const largeBar = (heading: string) => `
  <ui-top-app-bar size="large" heading="${heading}">
    <ui-icon-button uiTopAppBarActions variant="tonal" icon="settings" label="Übersicht anpassen" />
    <ui-icon-button uiTopAppBarActions variant="tonal" icon="person_add" label="Konto" />
  </ui-top-app-bar>`;

export const Gross: StoryObj<UiTopAppBar> = {
  // The bar spans the whole phone, so the narrow frame is 320 px, not the content width.
  decorators: [withNarrowFrame],
  render: () => ({ template: largeBar('Unser Zuhause') }),
  play: async ({ canvas, canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
    const bar = canvasElement.querySelector('ui-top-app-bar')!;
    await expect(bar.getBoundingClientRect().height).toBeGreaterThanOrEqual(72);
    const title = getComputedStyle(canvasElement.querySelector('.title')!);
    await expect(title.fontWeight).toBe('600');
    await expect(title.fontSize).toBe('24px');
    await expect(canvas.queryByRole('heading')).toBeNull();
    for (const name of ['Übersicht anpassen', 'Konto']) {
      const rect = canvas.getByRole('button', { name }).getBoundingClientRect();
      await expect(rect.width).toBeGreaterThanOrEqual(48);
      await expect(rect.height).toBeGreaterThanOrEqual(48);
    }
  },
};

export const GrossSchmal: StoryObj<UiTopAppBar> = {
  decorators: [withPhoneFrame],
  render: () => ({
    template: largeBar('Haushalt der Familie Müller-Lüdenscheidt-Schmidtbauer am Sonnenweg'),
  }),
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
    const title = canvasElement.querySelector('.title')!;
    await expect(title.scrollHeight).toBeLessThanOrEqual(title.clientHeight);
    await expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
  },
};

export const Kombinationen: StoryObj<UiTopAppBar> = {
  decorators: [moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] })],
  render: () => ({
    template: `
      <ui-theme-matrix>
        <ng-template uiMatrixCell>
          ${largeBar('Unser Zuhause')}
          <ui-top-app-bar heading="Einstellungen">
            <ui-icon-button uiTopAppBarActions icon="notifications" label="Benachrichtigungen" />
          </ui-top-app-bar>
        </ng-template>
      </ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await expectThemeMatrix(canvasElement);
  },
};
