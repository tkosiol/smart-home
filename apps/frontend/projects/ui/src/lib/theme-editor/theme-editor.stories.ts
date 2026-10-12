import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { DEFAULT_INSTANCE_APPEARANCE, DEFAULT_PERSONAL_APPEARANCE } from '@smart/contracts';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, userEvent, waitFor } from 'storybook/test';
import {
  expectNoBrokenWords,
  expectNoHorizontalOverflow,
  withPhoneFrame,
} from '../testing/story-helpers';
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

/** Segments and color swatches are sized by the editor; both must be 48 × 48 px or larger. */
const expectTouchTargets = async (root: Element) => {
  for (const control of root.querySelectorAll<HTMLElement>('[role="radio"], .swatch')) {
    const { height, width } = control.getBoundingClientRect();
    await expect(height, control.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(48);
    await expect(width, control.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(48);
  }
};

/** The toolbar does not wait for the language to load: wait until no untranslated key is left. */
const waitUntilTranslated = (root: Element) =>
  waitFor(() => expect(root.textContent).not.toContain('ui.themeEditor.'));

export const Persoenlich: StoryObj<UiThemeEditor> = {
  render: (args) => ({ props: { ...args }, template: editor('personal') }),
  play: async ({ canvas, canvasElement }) => {
    await waitUntilTranslated(canvasElement);
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
    await waitUntilTranslated(canvasElement);
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
    await waitUntilTranslated(frame);
    await expectNoHorizontalOverflow(frame);
    await expectNoBrokenWords(frame);
    await expectTouchTargets(frame);
  },
};

/** Wired to the ThemeService: choosing "Dunkel" darkens the whole Storybook page. */
export const Live: StoryObj<UiThemeEditor> = {
  decorators: [moduleMetadata({ imports: [ThemeEditorLiveStoryComponent] })],
  render: () => ({ template: '<ui-theme-editor-live />' }),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getAllByRole('radio')[2]!);
    await waitFor(() => expect(document.documentElement.style.colorScheme).toBe('dark'));
  },
};
