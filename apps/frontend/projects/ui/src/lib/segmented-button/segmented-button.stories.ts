import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fireEvent, userEvent } from 'storybook/test';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../testing/story-helpers';
import { UiSegmentedButton, type UiSegmentOption } from './segmented-button';

const meta: Meta<UiSegmentedButton<string>> = {
  title: 'Bedienung/Segmented Button',
  component: UiSegmentedButton,
  args: {
    label: 'Modus',
    value: 'system',
    options: [
      { value: 'system', label: 'System' },
      { value: 'light', label: 'Hell', icon: 'light_mode' },
      { value: 'dark', label: 'Dunkel', icon: 'dark_mode' },
    ],
  },
};
export default meta;

// A plain value arg is re-applied by Storybook and would undo the selection; the story binding
// `[(value)]` to a story prop keeps the selection the component writes.
export const Standard: StoryObj<UiSegmentedButton<string>> = {
  render: (args) => ({
    props: { ...args },
    template: `<ui-segmented-button [label]="label" [options]="options" [(value)]="value" />`,
  }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('radiogroup', { name: 'Modus' })).toBeVisible();
    for (const radio of canvas.getAllByRole('radio')) {
      await expect(radio.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
    }
    await userEvent.tab();
    await expect(canvas.getByRole('radio', { name: 'System' })).toHaveFocus();
    // user-event sends no keyCode, and Material's group reads keyCode for the arrow keys.
    await fireEvent.keyDown(canvas.getByRole('radio', { name: 'System' }), {
      key: 'ArrowRight',
      code: 'ArrowRight',
      keyCode: 39,
    });
    await userEvent.keyboard(' ');
    await expect(canvas.getByRole('radio', { name: 'Hell' })).toBeChecked();
    await userEvent.click(canvas.getByRole('radio', { name: 'Dunkel' }));
    await expect(canvas.getByRole('radio', { name: 'Dunkel' })).toBeChecked();
  },
};

export const Deaktiviert: StoryObj<UiSegmentedButton<string>> = {
  args: { disabled: true },
  render: (args) => ({
    props: { ...args },
    template: `<ui-segmented-button [label]="label" [options]="options" [disabled]="disabled" [(value)]="value" />`,
  }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('radio', { name: 'Dunkel' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('radio', { name: 'Dunkel' }), { pointerEventsCheck: 0 });
    await expect(canvas.getByRole('radio', { name: 'System' })).toBeChecked();
    await expect(canvas.getByRole('radio', { name: 'Dunkel' })).not.toBeChecked();
  },
};

const CONTRAST_OPTIONS: readonly UiSegmentOption<string>[] = [
  { value: 'system', label: 'System' },
  { value: 'standard', label: 'Standard' },
  { value: 'medium', label: 'Mittel' },
  { value: 'high', label: 'Hoch' },
];

const FONT_OPTIONS: readonly UiSegmentOption<string>[] = [
  { value: 'roboto-flex', label: 'Roboto Flex' },
  { value: 'figtree', label: 'Figtree' },
  { value: 'atkinson', label: 'Atkinson Hyperlegible' },
];

// The theme editor's pickers on the narrowest phone: long labels wrap inside their segment
// instead of pushing the group wider than the screen.
export const Schmal: StoryObj<UiSegmentedButton<string>> = {
  decorators: [withNarrowFrame],
  render: () => ({
    props: {
      contrastOptions: CONTRAST_OPTIONS,
      fontOptions: FONT_OPTIONS,
      contrast: 'system',
      font: 'atkinson',
    },
    template: `
      <div style="display: grid; gap: 16px">
        <ui-segmented-button label="Kontrast" [options]="contrastOptions" [(value)]="contrast" />
        <ui-segmented-button label="Schrift" [options]="fontOptions" [(value)]="font" />
      </div>
    `,
  }),
  play: async ({ canvas, canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
    for (const radio of canvas.getAllByRole('radio')) {
      await expect(radio.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
      await expect(radio.getBoundingClientRect().width).toBeGreaterThanOrEqual(48);
    }
    await userEvent.click(canvas.getByRole('radio', { name: 'Hoch' }));
    await expect(canvas.getByRole('radio', { name: 'Hoch' })).toBeChecked();
    await userEvent.click(canvas.getByRole('radio', { name: 'Figtree' }));
    await expect(canvas.getByRole('radio', { name: 'Figtree' })).toBeChecked();
  },
};
