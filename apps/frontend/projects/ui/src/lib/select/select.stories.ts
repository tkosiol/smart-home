import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { expect, fireEvent, screen, userEvent, waitFor, within } from 'storybook/test';
import type { UiOption } from '../option';
import {
  expectNoBrokenWords,
  expectNoHorizontalOverflow,
  withPhoneFrame,
} from '../testing/story-helpers';
import { UiSelect } from './select';

const CONTRAST_OPTIONS: readonly UiOption<string>[] = [
  { value: 'system', label: 'System' },
  { value: 'standard', label: 'Standard' },
  { value: 'medium', label: 'Mittel' },
  { value: 'high', label: 'Hoch' },
];

// The panel is an overlay outside the story root; disabled animations show it at once.
const meta: Meta<UiSelect<string>> = {
  title: 'Bedienung/Auswahlfeld',
  component: UiSelect,
  decorators: [
    applicationConfig({
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    }),
  ],
  args: {
    label: 'Kontrast',
    hint: 'System folgt der Einstellung des Geräts',
    value: 'system',
    options: CONTRAST_OPTIONS,
  },
};
export default meta;

const template = `<ui-select [label]="label" [hint]="hint" [options]="options" [disabled]="disabled" [(value)]="value" />`;

export const Standard: StoryObj<UiSelect<string>> = {
  render: (args) => ({ props: { ...args }, template }),
  play: async ({ canvas }) => {
    const combobox = canvas.getByRole('combobox', { name: 'Kontrast' });
    // The combobox itself is only the 24px text line; the whole outlined container is the target
    // (a click anywhere on it opens the panel).
    const target = combobox.closest('.mat-mdc-form-field-flex')!;
    await expect(target.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
    await userEvent.tab();
    await expect(combobox).toHaveFocus();
    // Material reads keyCode (Enter 13, arrow down 40), which user-event does not send.
    await fireEvent.keyDown(combobox, { key: 'Enter', code: 'Enter', keyCode: 13 });
    const listbox = await screen.findByRole('listbox', { name: 'Kontrast' });
    for (const option of within(listbox).getAllByRole('option')) {
      await expect(option.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
    }
    await fireEvent.keyDown(combobox, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 });
    await fireEvent.keyDown(combobox, { key: 'Enter', code: 'Enter', keyCode: 13 });
    await waitFor(() => expect(combobox).toHaveTextContent('Standard'));
    await userEvent.click(combobox);
    await userEvent.click(await screen.findByRole('option', { name: 'Hoch' }));
    await waitFor(() => expect(combobox).toHaveTextContent('Hoch'));
  },
};

export const Deaktiviert: StoryObj<UiSelect<string>> = {
  args: { disabled: true },
  render: (args) => ({ props: { ...args }, template }),
  play: async ({ canvas }) => {
    const combobox = canvas.getByRole('combobox', { name: 'Kontrast' });
    await expect(combobox).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(combobox, { pointerEventsCheck: 0 });
    await expect(screen.queryByRole('listbox')).toBeNull();
  },
};

export const Schmal: StoryObj<UiSelect<string>> = {
  decorators: [withPhoneFrame],
  args: {
    label: 'Schrift der Installation',
    value: 'atkinson',
    options: [
      { value: 'roboto-flex', label: 'Roboto Flex' },
      { value: 'figtree', label: 'Figtree' },
      { value: 'atkinson', label: 'Atkinson Hyperlegible Next' },
    ],
    hint: 'Gilt für alle Nutzerinnen und Nutzer dieser Installation',
  },
  render: (args) => ({ props: { ...args }, template }),
  play: async ({ canvasElement }) => {
    const frame = canvasElement.querySelector('.story-narrow')!;
    await expectNoHorizontalOverflow(frame);
    await expectNoBrokenWords(frame);
  },
};
