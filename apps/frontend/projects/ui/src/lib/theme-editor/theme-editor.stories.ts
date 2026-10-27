import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { DEFAULT_INSTANCE_APPEARANCE, DEFAULT_PERSONAL_APPEARANCE } from '@smart/contracts';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, userEvent, waitFor } from 'storybook/test';
import {
  expectNoBrokenWords,
  expectNoHorizontalOverflow,
  touchTargetSize,
  withPhoneFrame,
} from '../testing/story-helpers';
import { waitForTranslations } from '../testing/storybook-environment';
import { ThemeEditorLiveStoryComponent } from './theme-editor-live.story-component';
import { UiThemeEditor } from './theme-editor';

const meta: Meta<UiThemeEditor> = {
  title: 'Theme/Theme-Editor',
  component: UiThemeEditor,
  decorators: [
    applicationConfig({
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    }),
  ],
  args: { instance: DEFAULT_INSTANCE_APPEARANCE, personal: DEFAULT_PERSONAL_APPEARANCE },
};
export default meta;

const editor = (mode: 'personal' | 'instance') =>
  `<ui-theme-editor mode="${mode}" [(instance)]="instance" [(personal)]="personal" />`;

/**
 * Segments (40 px high, their touch target is the control base's invisible box) and color
 * swatches are sized by the editor; both must reach 48 × 48 px.
 */
const expectTouchTargets = async (root: Element) => {
  for (const control of root.querySelectorAll<HTMLElement>('[role="radio"], .swatch')) {
    const { height, width } = control.matches('[role="radio"]')
      ? touchTargetSize(control)
      : control.getBoundingClientRect();
    await expect(height, control.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(48);
    await expect(width, control.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(48);
  }
};

export const Persoenlich: StoryObj<UiThemeEditor> = {
  render: (args) => ({ props: { ...args }, template: editor('personal') }),
  play: async ({ canvas, canvasElement }) => {
    await waitForTranslations();
    await expect(canvas.getByRole('radiogroup')).toBeVisible();
    await userEvent.click(canvas.getAllByRole('radio')[2]!);
    await expect(canvas.getAllByRole('radio')[2]).toBeChecked();
    await userEvent.click(canvas.getAllByRole('switch')[0]!);
    await waitFor(() => expect(canvasElement.querySelector('ui-theme-colors')).not.toBeNull());
    await expectTouchTargets(canvasElement);
  },
};

export const Installation: StoryObj<UiThemeEditor> = {
  render: (args) => ({ props: { ...args }, template: editor('instance') }),
  play: async ({ canvas, canvasElement }) => {
    await waitForTranslations();
    await expect(canvas.queryByRole('radiogroup')).toBeNull();
    await expect(canvas.getAllByRole('combobox')).toHaveLength(3);
    await expectTouchTargets(canvasElement);
  },
};

// The narrowest phone, with every section open: no sideways scrolling, no word broken mid-word.
// The second test-runner pass repeats this in English.
export const Schmal: StoryObj<UiThemeEditor> = {
  decorators: [withPhoneFrame],
  args: {
    personal: { ...DEFAULT_PERSONAL_APPEARANCE, colors: DEFAULT_INSTANCE_APPEARANCE.colors },
  },
  render: (args) => ({
    props: { ...args },
    template: `<div style="display: grid; gap: 48px">${editor('personal')}${editor('instance')}</div>`,
  }),
  play: async ({ canvasElement }) => {
    const frame = canvasElement.querySelector('.story-narrow')!;
    await waitForTranslations();
    const headings = [...frame.querySelectorAll('h2')];
    await expect(headings.length, 'section headings').toBeGreaterThan(0);
    for (const heading of headings) {
      await expect(heading.textContent?.trim().length, 'heading text').toBeGreaterThan(0);
    }
    await expectNoHorizontalOverflow(frame);
    await expectNoBrokenWords(frame);
    await expectTouchTargets(frame);
  },
};

/**
 * Wired to the ThemeService: choosing the mode the page is not in switches the whole Storybook
 * page. The toolbar sets the starting mode (dark in the second test-runner pass), so the story
 * picks the opposite one to prove the change in both passes, then restores the starting mode (the
 * test runner verifies the toolbar's theme after play).
 */
export const Live: StoryObj<UiThemeEditor> = {
  decorators: [moduleMetadata({ imports: [ThemeEditorLiveStoryComponent] })],
  render: () => ({ template: '<ui-theme-editor-live />' }),
  play: async ({ canvas }) => {
    await waitForTranslations();
    const root = document.documentElement;
    const wasDark = root.style.colorScheme === 'dark';
    // Radios are ordered system, light, dark.
    await userEvent.click(canvas.getAllByRole('radio')[wasDark ? 1 : 2]!);
    await waitFor(() => expect(root.style.colorScheme).toBe(wasDark ? 'light' : 'dark'));
    await userEvent.click(canvas.getAllByRole('radio')[wasDark ? 2 : 1]!);
    await waitFor(() => expect(root.style.colorScheme).toBe(wasDark ? 'dark' : 'light'));
  },
};
