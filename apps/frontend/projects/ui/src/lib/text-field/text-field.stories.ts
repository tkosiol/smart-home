import type { Meta, StoryObj } from '@storybook/angular';
import { expect, userEvent } from 'storybook/test';
import { UiTextField } from './text-field';

const meta: Meta<UiTextField> = {
  title: 'Formular/Textfeld',
  component: UiTextField,
  args: { label: 'Haushaltsname', hint: 'So heißt dein Zuhause in der App.', value: '' },
  // `value` is a model(): binding it two-way keeps what the user types (a plain arg would be re-applied).
  render: (args) => ({
    props: { ...args },
    template: `<ui-text-field
      [label]="label"
      [hint]="hint"
      [error]="error"
      [disabled]="disabled"
      [(value)]="value"
    />`,
  }),
};
export default meta;

export const Standard: StoryObj<UiTextField> = {
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: 'Haushaltsname' });
    await userEvent.tab();
    await expect(input).toHaveFocus();
    await userEvent.keyboard('Wohnung Süd');
    await expect(input).toHaveValue('Wohnung Süd');
  },
};

export const MitFehler: StoryObj<UiTextField> = {
  args: { value: 'x', error: 'Mindestens 2 Zeichen.' },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Haushaltsname' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(canvas.getByText('Mindestens 2 Zeichen.')).toBeVisible();
  },
};

export const Deaktiviert: StoryObj<UiTextField> = {
  args: { value: 'Wohnung Süd', disabled: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('textbox', { name: 'Haushaltsname' })).toBeDisabled();
  },
};
