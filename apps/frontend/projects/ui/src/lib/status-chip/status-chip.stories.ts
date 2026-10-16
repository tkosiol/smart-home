import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { expectThemeMatrix, rgb } from '../testing/theme-matrix';
import { ThemeMatrixStoryComponent, UiMatrixCell } from '../testing/theme-matrix.story-component';
import { UiStatusChip } from './status-chip';

const meta: Meta<UiStatusChip> = {
  title: 'Status/Status-Chip',
  component: UiStatusChip,
};
export default meta;

/** Every family as a container, and the neutral chip. */
const chips = `
  <div style="display: flex; flex-wrap: wrap; gap: 8px">
    <ui-status-chip text="Standard" />
    <ui-status-chip text="Angepasst (Standard: 25 %)" tone="primary" />
    <ui-status-chip text="An" tone="secondary" />
    <ui-status-chip text="Pflanze" tone="tertiary" />
    <ui-status-chip text="Offline" tone="error" />
    <ui-status-chip text="trocken" tone="dry" />
    <ui-status-chip text="OK" tone="ok" />
    <ui-status-chip text="nass" tone="wet" />
    <ui-status-chip text="Batterie" tone="warning" />
    <ui-status-chip text="Unbekannt" tone="offline" />
  </div>`;

export const Toene: StoryObj<UiStatusChip> = {
  render: () => ({ template: chips }),
  play: async ({ canvas }) => {
    const root = getComputedStyle(document.documentElement);
    const standard = canvas.getByText('Standard');
    await expect(getComputedStyle(standard).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-surface-container-high').trim()),
    );
    await expect(getComputedStyle(standard).borderRadius).toBe(
      root.getPropertyValue('--mat-sys-corner-full').trim(),
    );
    await expect(standard.getBoundingClientRect().height).toBe(32);
    await expect(getComputedStyle(canvas.getByText('trocken')).backgroundColor).toBe(
      rgb(root.getPropertyValue('--smart-status-dry-container').trim()),
    );
    await expect(getComputedStyle(canvas.getByText('Offline')).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-error-container').trim()),
    );
  },
};

export const Kombinationen: StoryObj<UiStatusChip> = {
  decorators: [moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] })],
  render: () => ({
    template: `<ui-theme-matrix><ng-template uiMatrixCell>${chips}</ng-template></ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await expectThemeMatrix(canvasElement);
  },
};
