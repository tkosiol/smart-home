import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiButton } from '../button/button';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../testing/story-helpers';
import { expectThemeMatrix, rgb } from '../testing/theme-matrix';
import { ThemeMatrixStoryComponent, UiMatrixCell } from '../testing/theme-matrix.story-component';
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
      <ui-empty-state icon="meeting_room" heading="Noch keine Räume" description="Hier erscheinen deine Räume mit ihren Geräten, sobald du sie anlegst.">
        <div uiEmptyStateActions><ui-button icon="add">Raum anlegen</ui-button></div>
      </ui-empty-state>`,
  }),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Noch keine Räume' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Raum anlegen' })).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};

/** "Nichts zu tun" (spec 3.4): the icon in a disc of the ok container colour. */
const calm = `<ui-empty-state icon="check" tone="ok" heading="Nichts zu tun" description="Es gibt keine offenen Hinweise." />`;

export const MitTon: StoryObj<UiEmptyState> = {
  render: () => ({ template: calm }),
  play: async ({ canvasElement }) => {
    const disc = canvasElement.querySelector('.disc')!;
    const root = getComputedStyle(document.documentElement);
    await expect(getComputedStyle(disc).backgroundColor).toBe(
      rgb(root.getPropertyValue('--smart-status-ok-container').trim()),
    );
    await expect(disc.getBoundingClientRect().width).toBe(72);
    await expect(disc).toHaveAttribute('aria-hidden', 'true');
  },
};

export const Kombinationen: StoryObj<UiEmptyState> = {
  decorators: [moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] })],
  render: () => ({
    template: `<ui-theme-matrix><ng-template uiMatrixCell>${calm}</ng-template></ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await expectThemeMatrix(canvasElement);
  },
};

export const Ueberschriftenebene: StoryObj<UiEmptyState> = {
  render: () => ({
    template: `<ui-empty-state icon="meeting_room" heading="Auf Ebene 3" [level]="3" />`,
  }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 3, name: 'Auf Ebene 3' })).toBeVisible();
  },
};
